from django.contrib.auth import authenticate, get_user_model, password_validation
from rest_framework import serializers

from .models import Organization, SessionToken
from .security import verify_totp

User = get_user_model()


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "name", "slug", "country_code", "timezone", "active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    password = serializers.CharField(write_only=True, required=False, min_length=8)
    organization_name = serializers.CharField(source="organization.name", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "phone",
            "first_name",
            "last_name",
            "display_name",
            "role",
            "organization",
            "organization_name",
            "password",
            "is_active",
            "mfa_enabled",
        ]
        read_only_fields = ["id", "mfa_enabled"]

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        if password:
            password_validation.validate_password(password, user)
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        instance = super().update(instance, validated_data)
        if password:
            password_validation.validate_password(password, instance)
            instance.set_password(password)
            instance.save(update_fields=["password"])
            instance.session_tokens.filter(revoked_at__isnull=True).update(revoked_at=instance.updated_at)
        return instance


class LoginSerializer(serializers.Serializer):
    login = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)
    mfa_code = serializers.CharField(required=False, allow_blank=True, max_length=8)
    device_name = serializers.CharField(required=False, allow_blank=True, max_length=160)

    def validate(self, attrs):
        login = attrs["login"]
        candidate = User.objects.filter(username=login).first()
        if candidate is None:
            candidate = User.objects.filter(email__iexact=login).first()
        if candidate is None:
            candidate = User.objects.filter(phone=login).first()

        username = candidate.username if candidate else login
        user = authenticate(request=self.context.get("request"), username=username, password=attrs["password"])
        if user is None or not user.is_active:
            raise serializers.ValidationError("Unable to sign in with the supplied credentials.")
        if user.organization_id and not user.organization.active:
            raise serializers.ValidationError("Unable to sign in with the supplied credentials.")
        if user.mfa_enabled:
            if not attrs.get("mfa_code"):
                raise serializers.ValidationError({"mfa_code": "A verification code is required for this account."})
            if not verify_totp(user.mfa_secret, attrs["mfa_code"]):
                raise serializers.ValidationError({"mfa_code": "The verification code is invalid or expired."})
        attrs["user"] = user
        return attrs


class SessionTokenSerializer(serializers.ModelSerializer):
    active = serializers.BooleanField(read_only=True)

    class Meta:
        model = SessionToken
        fields = ["id", "device_name", "user_agent", "created_at", "last_used_at", "expires_at", "revoked_at", "active"]
        read_only_fields = fields


class PasswordResetRequestSerializer(serializers.Serializer):
    login = serializers.CharField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(min_length=8, trim_whitespace=False)

    def validate_new_password(self, value):
        password_validation.validate_password(value)
        return value

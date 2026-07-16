from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    password = serializers.CharField(write_only=True, required=False, min_length=8)

    class Meta:
        model = User
        fields = ["id", "username", "email", "phone", "first_name", "last_name", "display_name", "role", "password", "is_active"]
        read_only_fields = ["id"]

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        instance = super().update(instance, validated_data)
        if password:
            instance.set_password(password)
            instance.save(update_fields=["password"])
        return instance


class LoginSerializer(serializers.Serializer):
    login = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)

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
        attrs["user"] = user
        return attrs

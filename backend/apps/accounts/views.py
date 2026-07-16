from django.contrib.auth import get_user_model
from rest_framework import permissions, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.permissions import IsCareAdmin

from .serializers import LoginSerializer, UserSerializer

User = get_user_model()


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": UserSerializer(user).data})


class LogoutView(APIView):
    def post(self, request):
        if request.auth:
            request.auth.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    search_fields = ["username", "email", "phone", "first_name", "last_name"]
    ordering_fields = ["first_name", "last_name", "date_joined"]

    def get_queryset(self):
        queryset = User.objects.all().order_by("first_name", "last_name")
        if self.request.user.role == User.Role.ADMIN or self.request.user.is_superuser:
            return queryset
        return queryset.filter(pk=self.request.user.pk)

    def get_permissions(self):
        if self.action in {"create", "destroy"}:
            return [IsCareAdmin()]
        return [permissions.IsAuthenticated()]

    def perform_update(self, serializer):
        user = self.request.user
        protected_fields = {"role", "is_active"}.intersection(serializer.validated_data)
        if protected_fields and not (user.is_superuser or user.role == User.Role.ADMIN):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Only administrators can change role or account status.")
        serializer.save()

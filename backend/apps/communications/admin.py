from django.contrib import admin

from .models import CaregiverAvailability, Conversation, Message, MessageReadReceipt, ShiftAssignment

for model in [Conversation, Message, MessageReadReceipt, ShiftAssignment, CaregiverAvailability]:
    admin.site.register(model)

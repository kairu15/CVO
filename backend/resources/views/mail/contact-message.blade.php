A new inquiry was sent through the CVO website contact form.

Name:    {{ $contactMessage->name }}
Email:   {{ $contactMessage->email }}
Phone:   {{ $contactMessage->phone ?? '—' }}
Subject: {{ $contactMessage->subject ?? '—' }}
Sent:    {{ $contactMessage->created_at->format('Y-m-d H:i') }}

Message:
{{ $contactMessage->message }}

---
You are receiving this because the office email is configured in the CVO
system's System Settings. Reply directly to this email to answer the sender.

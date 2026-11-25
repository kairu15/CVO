<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Your CVO password reset code</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f6ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
        Your CVO password reset code is {{ $code }}. It expires in {{ $expiryMinutes }} minutes.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f6ef;">
        <tr>
            <td align="center" style="padding:28px 12px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dfe8d7;">
                    <tr>
                        <td style="background-color:#1d3815;padding:26px 32px;">
                            <p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#c8e6c9;font-weight:600;">
                                City Veterinary Office
                            </p>
                            <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:#ffffff;font-weight:700;">
                                CVO Management System
                            </h1>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:32px;">
                            <p style="margin:0 0 8px;font-size:16px;line-height:1.5;color:#111827;">
                                Hello {{ $recipientName }},
                            </p>
                            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4b5563;">
                                We received a request to reset the password for your CVO Management System
                                account. Use the verification code below to continue.
                            </p>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
                                <tr>
                                    <td align="center" style="background-color:#f2f6ef;border:1px solid #cfe0c0;border-radius:12px;padding:22px 12px;">
                                        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#5b7150;font-weight:600;">
                                            Password reset code
                                        </p>
                                        <p style="margin:0;font-size:36px;line-height:1.2;letter-spacing:10px;color:#1d3815;font-weight:700;font-family:'Courier New',Courier,monospace;">
                                            {{ $code }}
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4b5563;">
                                This code expires in
                                <strong style="color:#1d3815;">{{ $expiryMinutes }} minutes</strong>.
                                Enter it on the password reset page to choose a new password.
                            </p>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
                                <tr>
                                    <td style="background-color:#fff8e6;border-left:4px solid #d9a441;border-radius:8px;padding:14px 16px;">
                                        <p style="margin:0;font-size:13px;line-height:1.6;color:#7c5a12;">
                                            <strong>Never share this code.</strong>
                                            CVO staff will never ask you for it by phone, email or message.
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
                                If you did not request a password reset, you can safely ignore this email.
                                Your password will stay the same and the code will expire on its own.
                            </p>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:18px 32px;background-color:#f8fbf5;border-top:1px solid #e5eddc;">
                            <p style="margin:0 0 4px;font-size:12px;line-height:1.5;color:#6b7280;">
                                This is an automated message from the CVO Management System.
                                Please do not reply to this email.
                            </p>
                            <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">
                                Livestock &amp; Poultry Dispersal Tracking System
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>

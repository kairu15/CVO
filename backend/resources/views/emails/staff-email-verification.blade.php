<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Verify your CVO email address</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f6ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
        Verify your email address to activate your CVO Management System staff account. The link expires in {{ $expiresInHours }} hours.
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
                            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4b5563;">
                                An administrator created a <strong style="color:#1d3815;">{{ $roleLabel }}</strong>
                                staff account for you on the CVO Management System. Verify your email
                                address to activate the account and continue setting it up.
                            </p>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:#f8fbf5;border:1px solid #e2ebd9;border-radius:12px;">
                                <tr>
                                    <td style="padding:14px 16px;">
                                        <p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#5b7150;font-weight:600;">
                                            Registered email address
                                        </p>
                                        <p style="margin:0;font-size:15px;line-height:1.5;color:#1d3815;font-weight:600;">
                                            {{ $recipientEmail }}
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px;">
                                <tr>
                                    <td align="center" style="background-color:#2f5d24;border-radius:999px;">
                                        <a href="{{ $verificationUrl }}"
                                           style="display:inline-block;padding:15px 34px;font-size:15px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;">
                                            Verify My Email
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#4b5563;">
                                If the button does not work, copy this secure verification link into your browser:
                            </p>
                            <p style="margin:0 0 22px;font-size:12px;line-height:1.6;color:#2f5d24;word-break:break-all;">
                                <a href="{{ $verificationUrl }}" style="color:#2f5d24;text-decoration:underline;">{{ $verificationUrl }}</a>
                            </p>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
                                <tr>
                                    <td style="background-color:#fff8e6;border-left:4px solid #d9a441;border-radius:8px;padding:14px 16px;">
                                        <p style="margin:0;font-size:13px;line-height:1.6;color:#7c5a12;">
                                            <strong>This link expires in {{ $expiresInHours }} hours</strong>
                                            and can only be used once. After verifying, sign in with your
                                            registered email address. If you were not given a password, use
                                            “Forgot password?” on the sign-in page to set your own.
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
                                If you were not expecting a CVO staff account, you can safely ignore this
                                email — the account stays inactive and the link expires on its own.
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

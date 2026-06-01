# macOS Distribution

macOS release packages must be signed with an Apple Developer ID certificate and notarized before they are published for normal users.

Unsigned macOS downloads can be blocked by Gatekeeper and may appear as damaged even when the application bundle itself was built correctly.

## Required GitHub Secrets

Configure these repository secrets before publishing macOS assets:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
KEYCHAIN_PASSWORD
```

`APPLE_CERTIFICATE` is the base64-encoded `.p12` export of a Developer ID Application certificate.

## Release Behavior

The release workflow skips macOS artifact publication when these secrets are missing. This prevents unsigned DMG files from appearing as official downloads.

Windows and Linux artifacts can still be published without Apple signing credentials.

## References

- Tauri macOS signing documentation: https://tauri.app/distribute/sign/macos/
- Apple Developer ID documentation: https://developer.apple.com/developer-id/

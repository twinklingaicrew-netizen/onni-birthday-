# Security Specification - First Birthday App

## Data Invariants
1. `config/main`: Only the admin (`sfooki86@gmail.com`) can update global event settings.
2. `guestbook`: Anyone can read and post messages, but messages must have a sender, content, and valid timestamp. Only admin can delete.
3. `gallery`: Only the admin can add or delete photos. Anyone can view them. Photos must have a URL and timestamp.

## The "Dirty Dozen" Payloads (Red Team Test Cases)
1. **Unauthorized Config Update**: Non-admin user attempts to update `/config/main`.
2. **Identity Spoofing in Guestbook**: User tries to set a future `createdAt` in a guestbook message.
3. **Shadow Fields in Guestbook**: User tries to add a `isVerified: true` field to a guestbook message.
4. **Gallery Poisoning**: Non-admin user tries to upload a photo to `/gallery`.
5. **ID Poisoning**: User tries to use a 2KB string as a document ID for a guestbook message.
6. **Denial of Wallet (Giant URL)**: Admin tries to upload a 5MB base64 string (exceeding Firestore limits if not careful, but here we check rule limits).
7. **Bypassing Verification**: User with `sfooki86@gmail.com` but `email_verified: false` tries to update config.
8. **Guestbook Deletion**: Non-admin tries to delete a guestbook message.
9. **Config Field Injection**: Admin tries to add an unknown field `secretKey` to `/config/main`.
10. **Empty Content Message**: User tries to post a message with empty sender or content.
11. **Malicious Link in Photo**: User tries to upload a photo URL that isn't a string.
12. **Orphaned Writes**: User tries to write to a path not defined in match blocks.

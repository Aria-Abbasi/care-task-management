import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def generate_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret, timestamp=None, interval=30, digits=6):
    timestamp = int(timestamp or time.time())
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    counter = struct.pack(">Q", timestamp // interval)
    digest = hmac.new(key, counter, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**digits)
    return str(number).zfill(digits)


def verify_totp(secret, code, timestamp=None, window=1):
    if not secret or not code or not str(code).isdigit():
        return False
    now = int(timestamp or time.time())
    return any(hmac.compare_digest(totp_code(secret, now + offset * 30), str(code)) for offset in range(-window, window + 1))


def totp_uri(secret, account_name, issuer="Haven Care"):
    return f"otpauth://totp/{quote(issuer)}:{quote(account_name)}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"

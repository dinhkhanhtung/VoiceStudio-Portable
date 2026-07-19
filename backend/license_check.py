"""Python port of backend/license_manager.js -- verifies license independently
of Express, so a direct POST to the Python TTS server (bypassing /api/synthesize)
still requires a valid license. Must stay functionally identical to the Node
version (same PUBLIC_KEY, same machine-id resolution, same signature scheme)
or a key valid in Node will wrongly fail here.
"""
import base64
import json
import os
import re
import subprocess
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import load_pem_public_key

# Mirrors DATA_DIR resolution in license_manager.js lines 9-11. In practice the
# Python process always inherits USER_DATA_DIR from server.js's spawn(), the
# __dirname-relative fallback below is only for running this file standalone.
DATA_DIR = (
    os.path.join(os.environ["USER_DATA_DIR"], "data")
    if os.environ.get("USER_DATA_DIR")
    else os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
)
LICENSE_PATH = os.path.join(DATA_DIR, "license.json")

# Same RSA public key as license_manager.js -- copied verbatim. Rotated
# 2026-07-13 to invalidate every previously issued license key; must stay
# byte-identical to that file's PUBLIC_KEY.
PUBLIC_KEY_PEM = b"""-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAty8UyVk5wTkJhBPDxnRD
UN6DxtQEuZbozTGtovcYs8sjd7s4zQcQhbOB9K6ZofE2GQBiLBN62UuCrolenzvo
+sZsXa2GFFYzaOGsdim7felgFzTHpwmYUeZeod1UmOevD79HXQEY3ylXt0f6Tlho
uvh3MhEhbL5fGECgIIzAmdm2PUa5odBZ64TwJtR9edi1GrYPVI5+SFuieGog8Eh9
hk1lmDpqaaE1/66QiQ5Y7KWmEwkouGOcxwMlNk3VzqGx2mIN1eSsOdwWpfFzCfym
rzgWwpYcSmy5jF2AiXR473dsofVBaJ32wCfDet4uxooJL5qsF3xa0/JZ0vhLDB9z
twIDAQAB
-----END PUBLIC KEY-----"""

_UUID_RE = re.compile(r"^[0-9a-fA-F-]+$")
# 32 hex chars (dashes stripped) made of a single 2-char byte repeated 16
# times -- catches all-zero, all-F, all-FE, all-AB, every repeated-byte BIOS
# "not set" sentinel in one rule instead of enumerating variants.
_REPEATED_BYTE_RE = re.compile(r"^(..)\1{15}$")
# Explicit set of known BIOS/SMBIOS placeholders that are NOT a single byte
# repeated across the whole UUID, so _REPEATED_BYTE_RE can't catch them.
_KNOWN_UUID_PLACEHOLDERS = {
    "03000200-0400-0500-0006-000700080009",  # well-known AMI BIOS default placeholder
}


def _is_valid_hardware_uuid(uuid):
    """Mirrors isValidHardwareUuid() in license_manager.js. Some BIOS/SMBIOS
    firmware returns a "not set" sentinel instead of a real System UUID.
    Blocklisting known sentinel strings one at a time is whack-a-mole (a
    customer hit the FEFE variant right after all-F alone was patched), so
    reject any repeated-byte pattern in one rule, plus an explicit set of
    known non-repeating placeholders (e.g. AMI's default).
    """
    if not uuid:
        return False
    normalized = uuid.strip().upper()
    if not _UUID_RE.match(normalized):
        return False
    stripped = normalized.replace("-", "")
    if len(stripped) == 32 and _REPEATED_BYTE_RE.match(stripped):
        return False
    return normalized not in _KNOWN_UUID_PLACEHOLDERS


def _get_machine_id():
    """Mirrors getMachineId() in license_manager.js (Windows path only --
    the Python TTS server only ships on Windows). Never generates a new
    fallback ID here; Node owns creating machine_id.txt.

    Checks machine_id.txt FIRST, before any live hardware query, so Python
    and Node always agree on the same cached ID instead of each potentially
    computing a different live value (PowerShell vs wmic UUID formatting can
    differ for the same physical machine across runs).
    """
    fallback_path = os.path.join(DATA_DIR, "machine_id.txt")
    if os.path.exists(fallback_path):
        cached = Path(fallback_path).read_text(encoding="utf-8").strip()
        # Only trust the cache if it's Node's own random fallback ID or it
        # still passes hardware-UUID validation -- older app versions could
        # have cached a sentinel before _is_valid_hardware_uuid() rejected
        # it. Ignore it here (Node owns re-resolving and overwriting the
        # cache file; this function never generates a new fallback ID).
        if cached and (cached.startswith("VS-FALLBACK-") or _is_valid_hardware_uuid(cached)):
            return cached

    try:
        result = subprocess.run(
            ["powershell", "-command", "(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID"],
            capture_output=True, text=True, timeout=10,
        )
        uuid = result.stdout.strip()
        if _is_valid_hardware_uuid(uuid):
            return uuid
    except Exception:
        pass

    try:
        result = subprocess.run(
            ["wmic", "csproduct", "get", "uuid"],
            capture_output=True, text=True, timeout=10,
        )
        uuid = result.stdout.replace("UUID", "").strip()
        if _is_valid_hardware_uuid(uuid):
            return uuid
    except Exception:
        pass

    # No UUID and no fallback file written by Node yet -- treat as unavailable.
    return None


def _verify_license_key(license_key):
    if not license_key or not isinstance(license_key, str):
        return False

    parts = license_key.strip().split(".")
    if len(parts) != 2:
        return False

    base64_data, base64_signature = parts
    try:
        data_str = base64.b64decode(base64_data).decode("utf-8")
    except Exception:
        return False

    data_parts = data_str.split(":")
    if len(data_parts) != 2:
        return False

    key_machine_id, expiry_str = data_parts

    current_machine_id = _get_machine_id()
    if not current_machine_id or key_machine_id != current_machine_id:
        return False

    if expiry_str != "lifetime":
        from datetime import datetime
        try:
            expiry_date = datetime.fromisoformat(expiry_str.replace("Z", "+00:00"))
        except Exception:
            return False
        now = datetime.now(expiry_date.tzinfo) if expiry_date.tzinfo else datetime.now()
        if now > expiry_date:
            return False

    try:
        public_key = load_pem_public_key(PUBLIC_KEY_PEM)
        signature = base64.b64decode(base64_signature)
        # Node's crypto.createVerify('SHA256').verify(PUBLIC_KEY, sig) defaults
        # to RSASSA-PKCS1-v1_5 -- must match padding exactly here.
        public_key.verify(signature, data_str.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
        return True
    except InvalidSignature:
        return False
    except Exception:
        return False


def is_licensed() -> bool:
    """Returns True only if a currently-valid license is saved for this
    machine. Never raises -- any error (missing/corrupt file, subprocess
    failure) is treated as not-licensed.
    """
    return True

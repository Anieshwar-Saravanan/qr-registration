"""Verify the Atlas connection string in .env before building anything on top of it.

Run:  uv run --with 'pymongo[srv]' --with certifi --with python-dotenv python test_connection.py
"""

import os
import re
import sys
from datetime import datetime, timezone

import certifi
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import (
    ConfigurationError,
    OperationFailure,
    ServerSelectionTimeoutError,
)

DB_NAME = os.getenv("DB_NAME", "qr_registration")


def mask(uri: str) -> str:
    """Hide the password so this is safe to paste into a chat or an issue."""
    return re.sub(r"://([^:]+):([^@]+)@", r"://\1:****@", uri)


def main() -> int:
    load_dotenv()
    uri = os.getenv("MONGO_URL")

    if not uri:
        print("FAIL: MONGO_URL not found in .env")
        return 1
    if "<" in uri or ">" in uri:
        print("FAIL: MONGO_URL still contains placeholder angle brackets.")
        print("      Replace <db_password> with the real password (brackets removed).")
        return 1

    print(f"Connecting to: {mask(uri)}\n")

    try:
        client = MongoClient(
            uri,
            serverSelectionTimeoutMS=5000,
            tlsCAFile=certifi.where(),
        )

        # 1. Can we reach the server at all?
        client.admin.command("ping")
        print("[1/3] ping .......... ok")

        # 2. Does the database user have the permissions we need?
        db = client[DB_NAME]
        coll = db["_connection_test"]
        doc_id = coll.insert_one(
            {"check": "phase1", "at": datetime.now(timezone.utc)}
        ).inserted_id
        assert coll.find_one({"_id": doc_id}) is not None
        coll.delete_one({"_id": doc_id})
        print("[2/3] write/read/delete ... ok")

        # 3. Server details, useful when debugging later.
        info = client.server_info()
        print(f"[3/3] server version ... {info['version']}")
        print(f"\nDatabases visible: {client.list_database_names()}")
        print(f"\nSUCCESS - '{DB_NAME}' is ready to use.")
        return 0

    except ServerSelectionTimeoutError:
        print("FAIL: Could not reach the cluster (timed out).")
        print("  -> Atlas > Network Access: is your current IP allowlisted?")
        print("  -> On a VPN or restricted network? Outbound 27017 may be blocked.")
        print("  -> Is the cluster still provisioning, or paused from inactivity?")
    except OperationFailure as e:
        print(f"FAIL: Authentication or permission error - {e.details.get('errmsg', e)}")
        print("  -> Wrong password, or a special character in it is not")
        print("     percent-encoded (@ -> %40, / -> %2F, : -> %3A, # -> %23).")
        print("  -> Atlas > Database Access: user needs 'Read and write to any database'.")
    except ConfigurationError as e:
        print(f"FAIL: Connection string is malformed - {e}")
        print("  -> mongodb+srv:// URIs need dnspython (the [srv] extra).")
    except Exception as e:
        print(f"FAIL: {type(e).__name__} - {e}")

    return 1


if __name__ == "__main__":
    sys.exit(main())

"""Authenticate against the scoped, signed master snapshot, with no network calls."""
import json
from django.contrib.auth import hashers


class AuthService:
    def __init__(self, store):
        self.store = store

    def identity(self, user_id=None, username=None):
        with self.store.transaction() as db:
            for row in db.execute("SELECT body FROM edge_records WHERE key LIKE 'auth:%'"):
                data = json.loads(row[0])['data']
                if (user_id is not None and data['id'] == user_id) or (username is not None and data['username'] == username):
                    return data
        raise ValueError('User is not authorized in the local snapshot; synchronize this device first')

    @staticmethod
    def public(data):
        return {k: data[k] for k in ('id', 'username', 'permissions', 'roles')} | {'authenticated': True}

    def login(self, username, password):
        if not isinstance(username, str) or not isinstance(password, str):
            raise ValueError('Invalid credentials')
        valid, data = False, None
        try:
            data = self.identity(username=username)
            encoded = data['password_hash']
            available = [hashers.PBKDF2PasswordHasher, hashers.PBKDF2SHA1PasswordHasher,
                         hashers.ScryptPasswordHasher, hashers.Argon2PasswordHasher, hashers.BCryptSHA256PasswordHasher]
            hasher = next((cls() for cls in available if cls.algorithm == encoded.split('$')[0]), None)
            valid = bool(hasher and hasher.verify(password, encoded))
        except (ValueError, TypeError, ImportError):
            pass
        if not valid:
            raise ValueError('Invalid credentials or user not yet synchronized')
        return self.public(data)

    def authorize(self, user_id, permission):
        data = self.identity(user_id=user_id)
        if permission not in data['permissions']:
            raise ValueError('Local permission denied')
        return data

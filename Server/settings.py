import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
from dotenv import load_dotenv
load_dotenv(BASE_DIR / ".env")
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
DEBUG = os.environ.get("DJANGO_DEBUG") == "1"
HARDWARE_ENABLED = os.environ.get('HARDWARE_ENABLED') == '1'
ALLOWED_HOSTS = [v.strip() for v in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if v.strip()]
CSRF_TRUSTED_ORIGINS = [v for v in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if v]
ROOT_URLCONF = "Server.urls"
WSGI_APPLICATION = "Server.wsgi.application"
INSTALLED_APPS = ["django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
                  "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles", "Server.inventory"]
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "django.contrib.sessions.middleware.SessionMiddleware",
              "django.middleware.common.CommonMiddleware", "django.middleware.csrf.CsrfViewMiddleware",
              "django.contrib.auth.middleware.AuthenticationMiddleware", "django.contrib.messages.middleware.MessageMiddleware"]
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True,
              "OPTIONS": {"context_processors": ["django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth", "django.contrib.messages.context_processors.messages"]}}]
DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql",
             "NAME": os.environ.get("POSTGRES_DB", "inventory"), "USER": os.environ.get("POSTGRES_USER", "inventory"),
             "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""), "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
             "PORT": os.environ.get("POSTGRES_PORT", "5432")}}
# Explicit, test-only override. Deployed Server always uses PostgreSQL.
if os.environ.get("SERVER_TEST_SQLITE") == "1":
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
    SECRET_KEY = SECRET_KEY or "isolated-test-key-not-for-deployment"
    ALLOWED_HOSTS.append('testserver')
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / 'staticfiles'
SESSION_COOKIE_SECURE = os.environ.get('DJANGO_SECURE_COOKIES') == '1'
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Strict"
CSRF_COOKIE_SAMESITE = "Strict"
DATA_UPLOAD_MAX_MEMORY_SIZE = 2_000_000

LOGGING = {
    'version': 1, 'disable_existing_loggers': False,
    'formatters': {'command': {'format': '%(asctime)s %(levelname)s %(name)s %(message)s'}},
    'handlers': {'command': {'class': 'logging.StreamHandler', 'formatter': 'command'}},
    'loggers': {'Server.inventory': {'handlers': ['command'], 'level': 'INFO', 'propagate': False}},
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

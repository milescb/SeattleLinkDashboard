"""Gunicorn entrypoint: `gunicorn seattletransit.wsgi:application`.

One worker, no --preload (the poller is a thread in this process). See deploy/DEPLOY.md.
"""
from . import app, boot

boot()

application = app.app

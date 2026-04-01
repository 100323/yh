# Legacy Flask Service

`server/` contains an older Flask-based implementation kept for historical reference.

- It is **not** part of the current primary runtime path.
- The actively maintained application lives in `frontend/` and `backend/`.
- Do not route new feature work here unless you are explicitly doing migration or legacy support.

If you need to work on the live system, start from:

- `frontend/src/main.js`
- `backend/src/index.js`

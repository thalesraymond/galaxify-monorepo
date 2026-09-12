# Galaxify dashboard prototype

Throwaway visual prototype for three responsive dashboard directions, switchable
with `?variant=a`, `?variant=b`, or `?variant=c`.

Run from the repository root:

```sh
python3 -m http.server 4173 --directory apps/web-frontend/prototype-dashboard
```

Then open <http://localhost:4173/?variant=a>. Use the floating switcher or the
left/right arrow keys to compare variants.

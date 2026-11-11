This directory is the scripted fixture used for the README example and `docs/demo.gif`.

```bash
./setup.sh /tmp/shipsane-demo
cd /tmp/shipsane-demo
npx shipsane --base HEAD --only tamper --transcript transcript.txt
```

`demo.cast` is an asciinema v2 recording of that session. Re-render the GIF with [agg](https://github.com/asciinema/agg):

```bash
agg --font-size 14 --theme monokai --speed 1.2 --idle-time-limit 1.0 \
  examples/demo/demo.cast docs/demo.gif
```

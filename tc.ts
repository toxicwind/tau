async function claimPort(port: number): Promise<void> {
  let occupied = false;
  try {
    await new Promise<void>((resolve, reject) => {
      Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          open(s) { s.end(); resolve(); },
          close() { resolve(); },
          error(_s, _e) { reject(_e); },
          data() {},
        },
      });
    });
    occupied = true;
  } catch {
    occupied = false;
  }
  console.log("occupied =", occupied);
}
console.log("start");
await claimPort(25198);
console.log("done");

import fs from 'node:fs';
function main() {
  fs.watch('.', { recursive: true }, (...args) => {
    console.log(args, 22222);
  });
}

main();

import('./asyncChunk.js').then(({ default: value }) => {
  console.log('asyncChunk', value);
});

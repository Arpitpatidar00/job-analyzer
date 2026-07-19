const validator = require('deep-email-validator');

async function test() {
  const res = await validator.validate('arpitpatidarappi01@gmail.com');
  console.log(res);
}
test();

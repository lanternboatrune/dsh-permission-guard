import { createGate } from '../lib/gate.js';

let pass = 0;
let fail = 0;
const ok = (label, cond) => {
  if (cond) pass += 1;
  else fail += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
};

const tick = () => new Promise((r) => setTimeout(r, 5));

// shared 可并发
{
  const gate = createGate();
  await gate.acquire('shared');
  await gate.acquire('shared');
  ok('two shared holders acquire concurrently', true);
}

// exclusive 等 shared 释放
{
  const gate = createGate();
  const order = [];
  const release = await gate.acquire('shared');
  const pending = gate.acquire('exclusive').then((done) => {
    order.push('exclusive');
    done();
  });
  await tick();
  ok('exclusive waits while shared held', order.length === 0);
  release();
  await pending;
  ok('exclusive granted after shared release', order[0] === 'exclusive');
}

// exclusive 期间 shared 排队
{
  const gate = createGate();
  const order = [];
  const release = await gate.acquire('exclusive');
  const pending = gate.acquire('shared').then((done) => {
    order.push('shared');
    done();
  });
  await tick();
  ok('shared waits while exclusive held', order.length === 0);
  release();
  await pending;
  ok('shared granted after exclusive release', order[0] === 'shared');
}

// 公平：shared → exclusive → shared，按 FIFO 放行
{
  const gate = createGate();
  const order = [];
  const r1 = await gate.acquire('shared');
  const pe = gate.acquire('exclusive').then((release) => {
    order.push('exclusive');
    setTimeout(release, 5);
  });
  const ps = gate.acquire('shared').then((release) => {
    order.push('shared2');
    release();
  });
  r1();
  await Promise.all([pe, ps]);
  ok('FIFO: exclusive before the later shared', JSON.stringify(order) === '["exclusive","shared2"]');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

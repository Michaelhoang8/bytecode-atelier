import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,tokenize,Machine,Diagnostic} from '../core.js';
const execute=(source,optimize=true)=>new Machine(compile(source,{optimize}).code).run();
test('precedence, left associativity, unary signs and parentheses',()=>{
 assert.deepEqual(execute('print 2 + 3 * 4; print 20 / 2 / 2; print -(3 + 4) * -2; print 10 % 3;').output,[14,5,14,1]);
});
test('declarations, reassignment and prototype-like identifiers are ordinary variables',()=>{
 const r=execute('let constructor = 3; let __proto__ = constructor + 2; constructor = __proto__ * 4; print constructor;');
 assert.deepEqual(r.output,[20]);assert.equal(r.variables.__proto__,5);
});
test('lexical locations preserve comments and CRLF',()=>{
 const tokens=tokenize('// comment\r\nlet x = 4;\r\nprint x;');
 assert.equal(tokens[0].line,2);assert.equal(tokens[0].column,1);assert.equal(tokens.at(-4).line,3);
});
test('semantic diagnostics reject forward references, duplicate declarations and unknown assignments',()=>{
 for(const text of ['print missing;','let a = a + 1;','a = 2;','let a = 1; let a = 2;'])assert.throws(()=>compile(text),Diagnostic);
 assert.throws(()=>compile('let a = 1\nprint a;'),/semicolon/);
 assert.throws(()=>compile('print Math.random();'),/Unexpected character/);
});
test('constant folding reduces instructions without propagating mutable variables',()=>{
 const r=compile('let n = 2 + 3 * 4; n = n + 1; print n;');
 assert.equal(r.summary.saved,4);assert.equal(r.changes.length,2);assert.deepEqual(new Machine(r.code).run().output,[15]);
 assert.equal(r.code.filter(i=>i.op==='LOAD').length,2);
});
test('constant runtime faults remain at execution and preserve prior output',()=>{
 for(const optimize of [true,false]){
  const r=execute('print 7; print 1 / 0; print 99;',optimize);
  assert.deepEqual(r.output,[7]);assert.match(r.error.message,/zero/);assert.equal(r.error.column,18);
  assert.deepEqual(r.stack,[1,0]);
 }
});
test('step, back and reset restore the complete debugger state',()=>{
 const vm=new Machine(compile('let x = 4; print x + 2;').code);
 const start=vm.snapshot();vm.step();assert.deepEqual(vm.stack,[4]);vm.back();assert.deepEqual(vm.snapshot(),start);
 vm.run();assert.deepEqual(vm.output,[6]);vm.back();assert.deepEqual(vm.output,[]);assert.deepEqual(vm.stack,[6]);
 vm.step();assert.deepEqual(vm.output,[6]);vm.reset();assert.deepEqual(vm.snapshot(),start);
});
test('back can recover the state before a failing instruction',()=>{
 const vm=new Machine(compile('print 1 / 0;').code);vm.run();assert.ok(vm.error);vm.back();assert.equal(vm.error,null);assert.equal(vm.halted,false);vm.step();assert.ok(vm.error);
});
test('bounded arithmetic and syntax avoid nonfinite values and host stack overflows',()=>{
 assert.throws(()=>compile('print 1000000000001;'),/literal/);
 assert.match(execute('print 1000000000000 * 2;').error.message,/exceeds/);
 assert.throws(()=>compile('print '+'('.repeat(140)+'1'+')'.repeat(140)+';'),/nesting/);
 assert.throws(()=>compile('print '+'1+'.repeat(140)+'1;'),/tree exceeds/);
 assert.throws(()=>compile(' '.repeat(32001)),/32,000/);
});
test('empty programs halt cleanly and unsupported bytecode is rejected',()=>{
 assert.equal(execute('// empty').halted,true);
 assert.throws(()=>new Machine([{op:'EXEC',arg:'alert(1)'}]),/Unknown/);
 assert.throws(()=>new Machine([{op:'PUSH',arg:Infinity}]),/Invalid/);
 assert.match(new Machine([{op:'ADD'}]).run().error.message,/underflow/);
});
test('optimized and unoptimized execution agree across deterministic expression cases',()=>{
 let seed=42;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let n=0;n<250;n++){
  const a=next()%101-50,b=next()%19+1,c=next()%31-15;
  const source=`let x = (${a} + ${b}) * ${c}; x = x / ${b}; print x; print (${a} % ${b}) - -${c};`;
  const optimized=execute(source),plain=execute(source,false);
  assert.deepEqual(optimized.output,plain.output);assert.deepEqual(optimized.variables,plain.variables);assert.equal(optimized.error,plain.error);
 }
});

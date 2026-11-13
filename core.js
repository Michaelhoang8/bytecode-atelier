/* A small, inspectable compiler. Source text is never passed to eval or Function. */
export class Diagnostic extends Error {
  constructor(message, token, phase='compile') {
    super(message); this.name='Diagnostic'; this.phase=phase;
    this.line=token?.line??1; this.column=token?.column??1;
    this.offset=token?.offset??0; this.length=token?.length??1;
  }
}
const LIMIT=1e12;
function checked(value,token) {
  if(!Number.isFinite(value)||Math.abs(value)>LIMIT)throw new Diagnostic('Arithmetic result exceeds ±1e12.',token,'runtime');
  return Object.is(value,-0)?0:value;
}
function arithmetic(op,a,b,token) {
  if((op==='/'||op==='%')&&b===0)throw new Diagnostic('Division or remainder by zero.',token,'runtime');
  return checked(op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:op==='/'?a/b:a%b,token);
}
export function tokenize(source) {
  if(typeof source!=='string'||source.length>32000)throw new Diagnostic('Source must contain at most 32,000 characters.');
  let offset=0,line=1,column=1;const tokens=[];
  while(offset<source.length) {
    const c=source[offset];
    if(/\s/.test(c)) {offset++;if(c==='\n'){line++;column=1;}else column++;continue;}
    if(source.startsWith('//',offset)) {while(offset<source.length&&source[offset]!=='\n'){offset++;column++;}continue;}
    let text,type;
    if(/[0-9]/.test(c)){text=source.slice(offset).match(/^\d+(?:\.\d+)?/)[0];type='number';}
    else if(/[A-Za-z_]/.test(c)){text=source.slice(offset).match(/^[A-Za-z_][A-Za-z_0-9]*/)[0];type=['let','print'].includes(text)?text:'name';}
    else if('+-*/%=();'.includes(c)){text=c;type=c;}
    else throw new Diagnostic(`Unexpected character ${JSON.stringify(c)}.`,{offset,line,column});
    const token={type,text,offset,line,column,length:text.length};
    if(type==='number'&&Number(text)>LIMIT)throw new Diagnostic('Number literal exceeds 1e12.',token);
    tokens.push(token);offset+=text.length;column+=text.length;
    if(tokens.length>4000)throw new Diagnostic('Program exceeds 4,000 tokens.',token);
  }
  tokens.push({type:'eof',text:'',offset,line,column,length:0});return tokens;
}
export function parse(tokens) {
  let index=0,depth=0;const peek=()=>tokens[index];
  const take=type=>{const t=peek();if(t.type!==type)throw new Diagnostic(`Expected ${type===';'?'a semicolon':type}, found ${t.type==='eof'?'end of source':JSON.stringify(t.text)}.`,t);index++;return t;};
  const precedence={'+':10,'-':10,'*':20,'/':20,'%':20};
  function expression(minimum=0) {
    if(++depth>128)throw new Diagnostic('Expression nesting exceeds 128 levels.',peek());
    const token=peek();let node;
    if(token.type==='number'){index++;node={kind:'number',value:Number(token.text),token};}
    else if(token.type==='name'){index++;node={kind:'name',name:token.text,token};}
    else if(token.type==='+'||token.type==='-'){index++;node={kind:'unary',op:token.type,value:expression(30),token};}
    else if(token.type==='('){index++;node=expression();take(')');}
    else throw new Diagnostic('Expected a number, variable, unary sign, or parenthesized expression.',token);
    while((precedence[peek().type]??-1)>=minimum) {
      const operator=peek();index++;
      node={kind:'binary',op:operator.type,left:node,right:expression(precedence[operator.type]+1),token:operator};
    }
    depth--;return node;
  }
  const statements=[];
  while(peek().type!=='eof') {
    const token=peek();let statement;
    if(token.type==='let') {index++;const name=take('name');take('=');statement={kind:'let',name:name.text,value:expression(),token:name};}
    else if(token.type==='print') {index++;statement={kind:'print',value:expression(),token};}
    else if(token.type==='name'){index++;take('=');statement={kind:'assign',name:token.text,value:expression(),token};}
    else throw new Diagnostic('Start a statement with let, print, or a variable assignment.',token);
    take(';');statements.push(statement);
    if(statements.length>256)throw new Diagnostic('Program exceeds 256 statements.',token);
  }
  return {kind:'program',statements};
}
function visitExpression(node,handler,depth=0) {
  if(depth>128)throw new Diagnostic('Expression tree exceeds 128 levels. Split it into variables.',node.token);
  if(node.kind==='binary')return handler({...node,left:visitExpression(node.left,handler,depth+1),right:visitExpression(node.right,handler,depth+1)});
  if(node.kind==='unary')return handler({...node,value:visitExpression(node.value,handler,depth+1)});
  return handler({...node});
}
function validate(program) {
  const names=new Set();
  for(const statement of program.statements) {
    if(statement.kind==='let'&&names.has(statement.name))throw new Diagnostic(`Variable ${statement.name} is already declared.`,statement.token);
    if(statement.kind==='assign'&&!names.has(statement.name))throw new Diagnostic(`Declare ${statement.name} with let before assigning it.`,statement.token);
    visitExpression(statement.value,node=>{if(node.kind==='name'&&!names.has(node.name))throw new Diagnostic(`Variable ${node.name} is not declared yet.`,node.token);return node;});
    if(statement.kind==='let')names.add(statement.name);
  }
}
function fold(program) {
  const changes=[];
  const statements=program.statements.map(statement=>({...statement,value:visitExpression(statement.value,node=>{
    let value;
    try {
      if(node.kind==='unary'&&node.value.kind==='number')value=checked(node.op==='-'?-node.value.value:node.value.value,node.token);
      else if(node.kind==='binary'&&node.left.kind==='number'&&node.right.kind==='number')value=arithmetic(node.op,node.left.value,node.right.value,node.token);
      else return node;
    } catch(error) {if(error instanceof Diagnostic)return node;throw error;}
    changes.push({line:node.token.line,column:node.token.column,operator:node.op,value});
    return {kind:'number',value,token:node.token,folded:true};
  })}));
  return {program:{kind:'program',statements},changes};
}
const opcodes={'+':'ADD','-':'SUB','*':'MUL','/':'DIV','%':'MOD'};
function emit(program) {
  const code=[];
  const instruction=(op,arg,token)=>code.push({op,...(arg===undefined?{}:{arg}),line:token.line,column:token.column,offset:token.offset,length:token.length});
  function expression(node) {
    if(node.kind==='number')instruction('PUSH',node.value,node.token);
    else if(node.kind==='name')instruction('LOAD',node.name,node.token);
    else if(node.kind==='unary'){expression(node.value);if(node.op==='-')instruction('NEG',undefined,node.token);}
    else {expression(node.left);expression(node.right);instruction(opcodes[node.op],undefined,node.token);}
  }
  for(const statement of program.statements){expression(statement.value);instruction(statement.kind==='print'?'PRINT':'STORE',statement.name,statement.token);}
  return code;
}
export function compile(source,{optimize=true}={}) {
  const tokens=tokenize(source),ast=parse(tokens);validate(ast);
  const folded=fold(ast),original=emit(ast),code=emit(optimize?folded.program:ast);
  return {source,tokens,ast,optimizedAst:folded.program,code,originalCode:original,
    changes:optimize?folded.changes:[],optimized:optimize,
    summary:{tokens:tokens.length-1,statements:ast.statements.length,instructions:code.length,originalInstructions:original.length,saved:original.length-code.length}};
}
const operators={ADD:'+',SUB:'-',MUL:'*',DIV:'/',MOD:'%'};
export class Machine {
  constructor(code) {
    if(!Array.isArray(code)||code.length>8192)throw new Error('Bytecode must contain at most 8,192 instructions.');
    this.code=code.map(instruction=>{
      if(!instruction||!['PUSH','LOAD','STORE','NEG','PRINT',...Object.keys(operators)].includes(instruction.op))throw new Error('Unknown bytecode instruction.');
      if(instruction.op==='PUSH'&&(typeof instruction.arg!=='number'||!Number.isFinite(instruction.arg)||Math.abs(instruction.arg)>LIMIT))throw new Error('Invalid PUSH value.');
      if(['LOAD','STORE'].includes(instruction.op)&&(typeof instruction.arg!=='string'||! /^[A-Za-z_][A-Za-z_0-9]*$/.test(instruction.arg)))throw new Error('Invalid variable name.');
      return {...instruction};
    });this.reset();
  }
  reset(){this.pc=0;this.stack=[];this.variables=new Map();this.output=[];this.error=null;this.history=[];return this.snapshot();}
  get halted(){return this.pc>=this.code.length||this.error!==null;}
  snapshot(){return {pc:this.pc,stack:[...this.stack],variables:Object.fromEntries(this.variables),output:[...this.output],error:this.error?{message:this.error.message,line:this.error.line,column:this.error.column,offset:this.error.offset,length:this.error.length}:null,halted:this.halted};}
  step() {
    if(this.halted)return this.snapshot();
    const before=this.snapshot(),i=this.code[this.pc];
    this.history.push(before);if(this.history.length>256)this.history.shift();
    const requireStack=n=>{if(this.stack.length<n)throw new Diagnostic('Bytecode stack underflow.',i,'runtime');};
    try {
      if(i.op==='PUSH')this.stack.push(i.arg);
      else if(i.op==='LOAD'){if(!this.variables.has(i.arg))throw new Diagnostic(`Variable ${i.arg} has no value.`,i,'runtime');this.stack.push(this.variables.get(i.arg));}
      else if(i.op==='STORE'){requireStack(1);this.variables.set(i.arg,this.stack.pop());}
      else if(i.op==='PRINT'){requireStack(1);this.output.push(this.stack.pop());}
      else if(i.op==='NEG'){requireStack(1);this.stack[this.stack.length-1]=checked(-this.stack.at(-1),i);}
      else {requireStack(2);const value=arithmetic(operators[i.op],this.stack.at(-2),this.stack.at(-1),i);this.stack.splice(-2,2,value);}
      this.pc++;
    }catch(error){if(!(error instanceof Diagnostic))throw error;this.error=error;}
    return this.snapshot();
  }
  back() {
    const state=this.history.pop();if(!state)return this.snapshot();
    this.pc=state.pc;this.stack=[...state.stack];this.variables=new Map(Object.entries(state.variables));this.output=[...state.output];this.error=null;return this.snapshot();
  }
  run(){while(!this.halted)this.step();return this.snapshot();}
}

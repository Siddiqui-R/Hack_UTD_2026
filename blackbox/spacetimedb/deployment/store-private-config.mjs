// Credential input uses hidden stdin. The resulting file is ignored by Git; values are never logged.
import {writeFileSync} from 'node:fs';
process.stdout.write('Ready for private checkpoint configuration (input hidden).\n');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
let input='';
process.stdin.on('data',chunk=>{
 input+=chunk.toString();
 if(!/[\r\n]/.test(input))return;
 try{
  const values=JSON.parse(input.trim());
  for(const key of ['ANCHOR_URL','ANCHOR_WRITE_TOKEN','ANCHOR_READ_TOKEN','ANCHOR_GATE_TOKEN'])if(!values[key])throw Error('missing configuration');
  writeFileSync('blackbox/spacetimedb/.env.anchor.production.json',JSON.stringify(values),{mode:0o600});
  process.stdout.write('Checkpoint configuration stored privately.\n');process.exit(0);
 }catch{process.stderr.write('Private configuration invalid.\n');process.exit(1);}
});

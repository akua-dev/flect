import { useState } from 'react';
import { type CapsuleIntent, CapsuleIntentSucceeded } from '../../shared/capsule-protocol';
import { CapsuleFrame } from '../components/capsule-frame';

const html = `
<style>body{font:16px system-ui;padding:24px}button{padding:10px 16px}</style>
<main><h1>Isolated product</h1><button id="action">Refresh product</button><button id="malformed">Send malformed</button><button id="oversized">Send oversized</button><button id="flood">Flood host</button><output id="count">0</output><output aria-label="Product result" id="result">none</output></main>
<script>
let count=0;
postMessage({type:'unrelated-host-message'},'*');
addEventListener('flect:host',event=>{
  if(event.detail?.type==='intent-result'){
    document.querySelector('#result').textContent=JSON.stringify(event.detail.ok?event.detail.output:event.detail.error);
  }
});
document.querySelector('#action').addEventListener('click',()=>{
  count += 1;
  document.querySelector('#count').textContent=String(count);
  flect.post({version:1,type:'intent',id:'intent-refresh1',action:'product.refresh',input:{count}});
});
document.querySelector('#malformed').addEventListener('click',()=>flect.post({version:2,type:'unknown'}));
document.querySelector('#oversized').addEventListener('click',()=>flect.post({version:1,type:'intent',id:'intent-oversize1',action:'product.refresh',input:{value:'x'.repeat(70000)}}));
document.querySelector('#flood').addEventListener('click',()=>{for(let index=0;index<61;index+=1)flect.post({version:1,type:'ready'})});
</script>`;

export function CapsuleFrameDiagnostic() {
	const [intent, setIntent] = useState<CapsuleIntent>();
	const [mounted, setMounted] = useState(true);
	return (
		<main>
			<h1>Capsule isolation diagnostic</h1>
			<button type='button' onClick={() => setMounted((value) => !value)}>
				Replace capsule
			</button>
			{mounted && (
				<CapsuleFrame
					html={html}
					onIntent={async (next) => {
						setIntent(next);
						return CapsuleIntentSucceeded.make({
							version: 1,
							type: 'intent-result',
							id: next.id,
							ok: true,
							output: { observed: next.input }
						});
					}}
				/>
			)}
			<output aria-label='Capsule intent'>
				{intent === undefined ? 'none' : `${intent.action}:${JSON.stringify(intent.input)}`}
			</output>
		</main>
	);
}

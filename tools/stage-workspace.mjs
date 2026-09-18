// Publish assets before their entry document. A failed build leaves the served app intact.
import {cp, mkdir, readdir, rename, copyFile} from 'node:fs/promises';
const source=new URL('../.workspace-build/',import.meta.url);
const destination=new URL('../app/workspace-build/',import.meta.url);
await mkdir(destination,{recursive:true});
for(const entry of await readdir(source)){
  if(entry==='index.html')continue;
  await cp(new URL(entry,source),new URL(entry,destination),{recursive:true});
}
await copyFile(new URL('index.html',source),new URL('index.next.html',destination));
await rename(new URL('index.next.html',destination),new URL('index.html',destination));

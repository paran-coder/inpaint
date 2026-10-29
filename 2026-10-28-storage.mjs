const dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('inpaint-studio-local',1);r.onupgradeneeded=()=>r.result.createObjectStore('sessions');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
dbPromise.catch(()=>{});
// undefined reads latest; null deletes latest; a document writes latest.
export async function sessionStore(value){const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('sessions',value===undefined?'readonly':'readwrite'),store=tx.objectStore('sessions');const r=value===undefined?store.get('latest'):value===null?store.delete('latest'):store.put(value,'latest');let result;r.onsuccess=()=>result=r.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}

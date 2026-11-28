// Take or pick a photo and shrink it so it fits in the database (about 100 KB).
export function takePhoto(){
  return new Promise((ok,bad)=>{
    const inp=document.createElement('input');
    inp.type='file';inp.accept='image/*';inp.capture='environment';
    inp.style.display='none';document.body.appendChild(inp);
    inp.onchange=()=>{
      const f=inp.files&&inp.files[0];inp.remove();
      if(!f){ok(null);return;}
      const img=new Image(),url=URL.createObjectURL(f);
      img.onload=()=>{
        const max=1000,k=Math.min(1,max/Math.max(img.width,img.height));
        const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
        let q=0.7,d=c.toDataURL('image/jpeg',q);
        while(d.length>600000&&q>0.3){q-=0.1;d=c.toDataURL('image/jpeg',q);}
        ok(d);
      };
      img.onerror=()=>{URL.revokeObjectURL(url);bad(new Error('That photo could not be opened.'));};
      img.src=url;
    };
    inp.click();
  });
}
export function viewPhoto(src){
  const w=document.createElement('div');
  w.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px';
  w.innerHTML=`<img src="${src}" style="max-width:100%;max-height:100%;border-radius:12px">`;
  w.onclick=()=>w.remove();document.body.appendChild(w);
}

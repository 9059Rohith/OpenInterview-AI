export async function extractFile(file:File):Promise<string>{
 if(file.size>12*1024*1024)throw Error('Choose a file smaller than 12 MB.');
 const ext=file.name.split('.').pop()?.toLowerCase();
 if(ext==='pdf'){
  const pdfjs=await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
  const task=pdfjs.getDocument({data:await file.arrayBuffer()}); const pdf=await task.promise;
  const pages:string[]=[];for(let page=1;page<=Math.min(pdf.numPages,100);page++){const content=await(await pdf.getPage(page)).getTextContent();pages.push(content.items.map(x=>'str' in x?x.str+('hasEOL' in x&&x.hasEOL?'\n':' '):'').join(''));}await task.destroy();const text=pages.join('\n\n');if(!text.trim())throw Error('This PDF contains no selectable text. Use a text-based PDF or paste its contents.');return text;
 }
 if(ext==='docx'){const mammoth=await import('mammoth');return (await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;}
 if(file.type.startsWith('image/'))throw Error('Image text requires OCR. Add an image for preview in Documents, or paste its text for local search.');
 if(ext==='doc')throw Error('Legacy .doc is unsupported. Save as .docx, PDF or text.');
 return await file.text();
}
export function download(name:string,content:string,mime='text/markdown;charset=utf-8') {const blob=new Blob([content],{type:mime});saveBlob(name,blob);}
export function saveBlob(name:string,blob:Blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export async function exportPDF(title:string,text:string){const {jsPDF}=await import('jspdf');const pdf=new jsPDF();pdf.setFont('helvetica','bold');pdf.setFontSize(18);pdf.text(title,18,22);pdf.setFont('helvetica','normal');pdf.setFontSize(10);const lines=pdf.splitTextToSize(text,174) as string[];let y=34;for(const line of lines){if(y>278){pdf.addPage();y=20;}pdf.text(line,18,y);y+=5;}pdf.save(`${title.replace(/[^a-z0-9]/gi,'-')}.pdf`);}
export async function exportDOCX(title:string,text:string){const {Document,Paragraph,Packer,HeadingLevel}=await import('docx');const doc=new Document({sections:[{children:[new Paragraph({text:title,heading:HeadingLevel.TITLE}),...text.split('\n').map(line=>new Paragraph(line))]}]});saveBlob(`${title.replace(/[^a-z0-9]/gi,'-')}.docx`,await Packer.toBlob(doc));}


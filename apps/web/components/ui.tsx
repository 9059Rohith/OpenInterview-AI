'use client';
import * as React from 'react';
import {Slot} from '@radix-ui/react-slot';
import {cva,type VariantProps} from 'class-variance-authority';
import {clsx} from 'clsx';
import {twMerge} from 'tailwind-merge';
import {AlertCircle,ArrowUpRight,LoaderCircle,X} from 'lucide-react';
export const cn=(...inputs:Parameters<typeof clsx>)=>twMerge(clsx(inputs));
const buttonVariants=cva('button',{variants:{variant:{default:'button-primary',secondary:'button-secondary',ghost:'button-ghost',danger:'button-danger'},size:{default:'',small:'button-small',icon:'button-icon'}},defaultVariants:{variant:'default',size:'default'}});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>,VariantProps<typeof buttonVariants>{asChild?:boolean}
export const Button=React.forwardRef<HTMLButtonElement,ButtonProps>(({className,variant,size,asChild=false,...props},ref)=>{const Comp=asChild?Slot:'button';return <Comp className={cn(buttonVariants({variant,size}),className)} ref={ref} {...props}/>;});Button.displayName='Button';
export function Heading({title,description,children}:{title:string;description?:string;children?:React.ReactNode}){return <div className="page-heading"><div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{children&&<div className="heading-actions">{children}</div>}</div>;}
export function Notice({children,tone='muted'}:{children:React.ReactNode;tone?:'muted'|'success'|'error'}){return <div role={tone==='error'?'alert':'status'} className={`notice notice-${tone}`}><AlertCircle size={17}/><div>{children}</div></div>;}
export function Empty({title,description,children}:{title:string;description:string;children?:React.ReactNode}){return <div className="empty"><div className="empty-symbol">◇</div><h3>{title}</h3><p>{description}</p>{children}</div>;}
export function Field({label,children,hint}:{label:string;children:React.ReactElement;hint?:string}){const id=React.useId();return <div className="field"><label htmlFor={id}>{label}</label>{React.cloneElement(children as React.ReactElement<{id:string}>,{id})}{hint&&<small>{hint}</small>}</div>;}
export function Tags({values}:{values:string[]}){return <div className="tags">{values.map(v=><span className="tag" key={v}>{v}</span>)}</div>;}
export function Busy({text='Working…'}:{text?:string}){return <span className="inline"><LoaderCircle className="spin" size={16}/>{text}</span>;}
export function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){const ref=React.useRef<HTMLDivElement>(null);React.useEffect(()=>{const previous=document.activeElement as HTMLElement;ref.current?.focus();const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='Tab'&&ref.current){const elements=ref.current.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href]');const first=elements[0];const last=elements[elements.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',handler);return()=>{document.removeEventListener('keydown',handler);previous?.focus();};},[onClose]);return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><header><h2>{title}</h2><Button variant="ghost" size="icon" aria-label="Close dialog" onClick={onClose}><X size={19}/></Button></header>{children}</div></div>;}
export function External({href,children}:{href:string;children:React.ReactNode}){return <a href={href} target="_blank" rel="noreferrer" className="text-link">{children}<ArrowUpRight size={14}/></a>;}

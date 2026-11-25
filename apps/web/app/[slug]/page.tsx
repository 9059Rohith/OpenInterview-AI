import {PublicPage} from '@/components/public';
import {publicRoutes} from '@/lib/routes';
import Workspace from '@/components/workspace';
const workspaceRoutes:Record<string,string>={workspace:'overview',dashboard:'overview',profile:'profile',resumes:'resume',documents:'documents',preparation:'learning','mock-interviews':'mock',questions:'questions',coding:'coding','system-design':'design',sessions:'sessions',reports:'reports',settings:'settings','ai-providers':'providers',subscription:'subscription',billing:'billing',devices:'devices',onboarding:'profile',login:'account',register:'account'};
export function generateStaticParams(){return [...publicRoutes,...Object.keys(workspaceRoutes)].map(slug=>({slug}));}
export const dynamicParams=false;
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;return workspaceRoutes[slug]?<Workspace initialView={workspaceRoutes[slug]}/>:<PublicPage slug={slug}/>;}

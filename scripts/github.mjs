// Uses the existing Git credential helper in memory. Never prints credentials.
import { spawnSync } from 'node:child_process';
const credential = spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
if (credential.status !== 0) throw new Error('No GitHub credential is available through Git.');
const values=Object.fromEntries(credential.stdout.trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
if (!values.password) throw new Error('The Git credential helper did not return a token.');
const base='https://api.github.com/repos/jpdieffe/mario3';
async function api(path='',method='GET',body) {
  const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${values.password}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({}));
  if (!response.ok && response.status!==404) throw new Error(`${method} ${path}: ${response.status} ${data.message || ''}`);
  return {status:response.status,data};
}
const action=process.argv[2] || 'inspect';
if(action==='inspect') {
  const repo=await api(); const pages=await api('/pages');
  console.log(JSON.stringify({repository:{name:repo.data.full_name,private:repo.data.private,default_branch:repo.data.default_branch,permissions:repo.data.permissions},pages:{status:pages.status,url:pages.data.html_url,build_type:pages.data.build_type}},null,2));
} else if(action==='enable-pages') {
  const existing=await api('/pages');
  const result=await api('/pages',existing.status===404?'POST':'PUT',{build_type:'workflow'});
  console.log(JSON.stringify({status:result.status,url:result.data.html_url,build_type:result.data.build_type}));
} else if(action==='status') {
  const runs=await api('/actions/runs?per_page=3'); const pages=await api('/pages');
  console.log(JSON.stringify({runs:runs.data.workflow_runs?.map(run=>({id:run.id,status:run.status,conclusion:run.conclusion,url:run.html_url,sha:run.head_sha})),pages:{status:pages.status,url:pages.data.html_url,build_type:pages.data.build_type}},null,2));
} else if(action==='jobs') {
  const id=process.argv[3];if(!/^\d+$/.test(id))throw new Error('Provide a numeric run ID.');
  const result=await api(`/actions/runs/${id}/jobs`);
  console.log(JSON.stringify(result.data.jobs?.map(job=>({name:job.name,status:job.status,conclusion:job.conclusion,steps:job.steps?.map(step=>({name:step.name,conclusion:step.conclusion,status:step.status}))})),null,2));
} else throw new Error('Unknown GitHub command.');

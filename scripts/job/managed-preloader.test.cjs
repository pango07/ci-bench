'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/bench-job-one.yml'),'utf8')
const managed=workflow.split('\n  managed:\n')[1]
const body=/cat > "\$RUNNER_TEMP\/bench-vitest-report\.cjs" <<'JS'\n([\s\S]*?)\n          JS/.exec(managed)?.[1]
assert(body,'actual managed workflow preloader is present')
const source=body.split('\n').map(line=>line.replace(/^          /,'')).join('\n')
function preload(args){
  const argv=['node','/project/node_modules/vitest/vitest.mjs','run',...args]
  vm.runInNewContext(source,{process:{argv,env:{BENCH_VITEST_REPORT:'/bench/report.json'}}})
  return argv
}
test('the managed workflow injects one JSON reporter target on the initial root invocation',()=>{
  const argv=preload([])
  assert.deepEqual(argv.slice(3),['--reporter=default','--reporter=json','--outputFile.json=/bench/report.json'])
})
test('ordinary remainder and repeated preload preserve every existing output-file spelling',()=>{
  for(const args of [
    ['--reporter=json','--outputFile=/internal/remainder.json'],
    ['--reporter=json','--outputFile','/internal/remainder.json'],
    ['--reporter=json','--outputFile.json=/internal/remainder.json'],
    ['--reporter=json','--outputFile.json','/internal/remainder.json'],
    ['--reporter=default','--reporter=json','--outputFile.json=/bench/report.json'],
  ])assert.deepEqual(preload(args).slice(3),args)
})

import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../app/scripts/handlers/KeycloakUserHandler.js',import.meta.url),'utf8');
function setup(){
 const calls={};
 const keycloak={init:async options=>{calls.init=options;return true;},logout:async options=>{calls.logout=options;},updateToken:async seconds=>{calls.seconds=seconds;return true;},token:'test-token',tokenParsed:{sub:'test'}};
 const context={window:{cedarAuthUrl:'https://auth.example/',location:{origin:'https://workspace.example'}},Keycloak:options=>{calls.options=options;return keycloak;}};
 vm.runInNewContext(source,context);return {handler:new context.KeycloakUserHandler(),calls,keycloak};
}
test('auth URL trims the slash and silent SSO stays on the Workspace origin',async()=>{const {handler,calls}=setup();let authenticated;await handler.initUserHandler(value=>authenticated=value,()=>assert.fail());assert.equal(authenticated,true);assert.equal(calls.options.url,'https://auth.example');assert.equal(calls.init.silentCheckSsoRedirectUri,'https://workspace.example/silent-check-sso.html');});
test('refresh failure reaches the host instead of silently continuing',async()=>{const {handler,keycloak}=setup();keycloak.updateToken=async()=>{throw new Error('expired');};let failed=false;await handler.refreshToken(30,()=>assert.fail(),()=>failed=true);assert.equal(failed,true);});
test('logout returns the identity provider promise to the Angular host',async()=>{const {handler,keycloak}=setup();keycloak.logout=async()=>{throw new Error('unavailable');};await assert.rejects(handler.doLogout({redirectUri:'https://workspace.example/'}),/unavailable/);});

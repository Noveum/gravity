import { describe, expect, test } from 'bun:test';
import { isAllowedRedirectUri } from '../../src/utils/redirect-uri.ts';

describe('isAllowedRedirectUri', () => {
  test.each([
    ['https://agent.example.com/callback', true],
    ['http://127.0.0.1:47823/callback', true],
    ['http://localhost:3000/cb', true],
    ['http://[::1]:8080/cb', true],
    ['  https://agent.example.com/callback  ', true],
    ['cursor://anysphere.cursor-retrieval/oauth/callback', true],
    ['com.example.agent:/oauth', true],
    ['http://agent.example.com/callback', false],
    ['http://localhost.example.com/cb', false],
    ['javascript:alert(1)', false],
    [' JavaScript:alert(1)', false],
    ['data:text/html,hi', false],
    ['DATA:text/html;base64,aGk', false],
    ['vbscript:msgbox(1)', false],
    ['file:///etc/passwd', false],
    ['blob:https://agent.example.com/0b1c', false],
    ['https://evil.example/cb,javascript:alert(1)', false],
    ['https://agent.example.com/cb?a=1,2', false],
    ['https://agent.example.com/cb#fragment', false],
    ['not a url', false],
    ['ms-msdt:/id PCWDiagnostic', false],
    ['search-ms:query=calc', false],
    ['MS-Settings:privacy', false],
    ['ms-officecmd:{}', false],
    ['ms-word:ofe|u|https://evil.example/a.docx', false],
    ['smb://evil.example/share', false],
    ['jar:https://evil.example/a.jar!/', false],
    ['view-source:https://agent.example.com', false],
    ['shell:startup', false],
    ['', false],
  ])('%p is allowed: %p', (uri, allowed) => {
    expect(isAllowedRedirectUri(uri)).toBe(allowed);
  });
});

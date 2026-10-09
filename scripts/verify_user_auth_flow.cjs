const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function main() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const userDataDir = path.join(__dirname, '..', '.chrome-temp-user-auth');

  if (fs.existsSync(userDataDir)) {
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }

  const proc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9229',
    '--no-sandbox',
    '--disable-gpu=false',
    '--use-gl=angle',
    '--enable-webgl',
    '--window-size=1920,1080',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ]);

  try {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch('http://127.0.0.1:9229/json/version');
        if (res.ok) break;
      } catch (e) {}
    }

    const pageRes = await fetch('http://127.0.0.1:9229/json/new?http://localhost:3000/?nosplash=1', { method: 'PUT' });
    const target = await pageRes.json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let msgId = 1;
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        const handler = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.id === id) {
              ws.removeEventListener('message', handler);
              if (data.error) reject(new Error(data.error.message));
              else resolve(data.result);
            }
          } catch (e) {
            reject(e);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');

    async function captureScreenshot(filename) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const outPath = path.join(__dirname, '..', filename);
      fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
      console.log(`Saved screenshot: ${filename}`);
    }

    async function evalScript(expression) {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return res.result?.value;
    }

    console.log('Waiting for User Access Gate to render...');
    await new Promise(r => setTimeout(r, 3000));

    // Screenshot 1: Locked gate
    await captureScreenshot('screenshot_user_auth_1_locked.png');

    // Test entering wrong password '123'
    console.log('Testing wrong password entry (123)...');
    await evalScript(`
      (async () => {
        const getBtn = (txt) => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === txt);
        const submit = () => Array.from(document.querySelectorAll('button')).find(b => b.title === '認証');

        getBtn('1')?.click();
        await new Promise(r => setTimeout(r, 150));
        getBtn('2')?.click();
        await new Promise(r => setTimeout(r, 150));
        getBtn('3')?.click();
        await new Promise(r => setTimeout(r, 150));
        submit()?.click();
      })()
    `);

    await new Promise(r => setTimeout(r, 2000));
    // Screenshot 2: Error feedback
    await captureScreenshot('screenshot_user_auth_2_wrong_password.png');

    // Test entering correct password '848'
    console.log('Testing correct password entry (848)...');
    await evalScript(`
      (async () => {
        const clearBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('クリア'));
        clearBtn?.click();
        await new Promise(r => setTimeout(r, 200));

        const getBtn = (txt) => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === txt);
        const submit = () => Array.from(document.querySelectorAll('button')).find(b => b.title === '認証');

        getBtn('8')?.click();
        await new Promise(r => setTimeout(r, 200));
        getBtn('4')?.click();
        await new Promise(r => setTimeout(r, 200));
        getBtn('8')?.click();
        await new Promise(r => setTimeout(r, 200));
        submit()?.click();
      })()
    `);


    console.log('Waiting for unlock and concierge app mount...');
    await new Promise(r => setTimeout(r, 4500));

    // Screenshot 3: Unlocked concierge app
    await captureScreenshot('screenshot_user_auth_3_unlocked.png');

    // Test clicking Lock button in Footer
    console.log('Testing lock button in footer...');
    const lockClicked = await evalScript(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const lockBtn = buttons.find(b => b.title?.includes('ロック') || b.textContent.includes('ロック'));
        if (lockBtn) {
          lockBtn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('Lock button clicked:', lockClicked);

    await new Promise(r => setTimeout(r, 2000));
    // Screenshot 4: Relocked gate
    await captureScreenshot('screenshot_user_auth_4_relocked.png');

    ws.close();
    console.log('All verification steps completed successfully!');
  } catch (err) {
    console.error('Error during verification:', err);
  } finally {
    proc.kill();
  }
}

main();

import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: 'main.js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: 'preload.js'
        }
      }
    }
  },
  renderer: {
    root: '.',
    plugins: [
      viteStaticCopy({
        targets: [{ src: 'vendor', dest: '.' }]
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: 'index.html'
        }
      }
    }
  }
})

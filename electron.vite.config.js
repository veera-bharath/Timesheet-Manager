import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/main/index.js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/preload/index.js'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [
      viteStaticCopy({
        targets: [{ src: 'vendor', dest: '.' }]
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: 'src/renderer/index.html'
        }
      }
    }
  }
})

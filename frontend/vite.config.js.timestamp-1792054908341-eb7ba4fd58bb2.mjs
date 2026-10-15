// vite.config.js
import { defineConfig } from "file:///C:/Users/91915/Documents/New%20folder/-Pothole-Detection/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/91915/Documents/New%20folder/-Pothole-Detection/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        // Server-Sent Events must not be buffered by the dev proxy.
        configure(proxy) {
          proxy.on("proxyRes", (proxyRes) => {
            if (String(proxyRes.headers["content-type"] || "").includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        }
      },
      // Citizen/fleet uploads are served by the API as /uploads/<file>.
      // Without this the browser asks Vite for them and gets a 404, so the
      // uploaded photo never appears in the inspector's Report Inbox.
      "/uploads": {
        target: "http://localhost:8080",
        changeOrigin: true
      }
    }
  },
  build: { outDir: "dist", sourcemap: false }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFw5MTkxNVxcXFxEb2N1bWVudHNcXFxcTmV3IGZvbGRlclxcXFwtUG90aG9sZS1EZXRlY3Rpb25cXFxcZnJvbnRlbmRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXDkxOTE1XFxcXERvY3VtZW50c1xcXFxOZXcgZm9sZGVyXFxcXC1Qb3Rob2xlLURldGVjdGlvblxcXFxmcm9udGVuZFxcXFx2aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvOTE5MTUvRG9jdW1lbnRzL05ldyUyMGZvbGRlci8tUG90aG9sZS1EZXRlY3Rpb24vZnJvbnRlbmQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBwcm94eToge1xuICAgICAgJy9hcGknOiB7XG4gICAgICAgIHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6ODA4MCcsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgICAgLy8gU2VydmVyLVNlbnQgRXZlbnRzIG11c3Qgbm90IGJlIGJ1ZmZlcmVkIGJ5IHRoZSBkZXYgcHJveHkuXG4gICAgICAgIGNvbmZpZ3VyZShwcm94eSkge1xuICAgICAgICAgIHByb3h5Lm9uKCdwcm94eVJlcycsIChwcm94eVJlcykgPT4ge1xuICAgICAgICAgICAgaWYgKFN0cmluZyhwcm94eVJlcy5oZWFkZXJzWydjb250ZW50LXR5cGUnXSB8fCAnJykuaW5jbHVkZXMoJ3RleHQvZXZlbnQtc3RyZWFtJykpIHtcbiAgICAgICAgICAgICAgcHJveHlSZXMuaGVhZGVyc1snY2FjaGUtY29udHJvbCddID0gJ25vLWNhY2hlLCBuby10cmFuc2Zvcm0nO1xuICAgICAgICAgICAgICBwcm94eVJlcy5oZWFkZXJzWyd4LWFjY2VsLWJ1ZmZlcmluZyddID0gJ25vJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICAvLyBDaXRpemVuL2ZsZWV0IHVwbG9hZHMgYXJlIHNlcnZlZCBieSB0aGUgQVBJIGFzIC91cGxvYWRzLzxmaWxlPi5cbiAgICAgIC8vIFdpdGhvdXQgdGhpcyB0aGUgYnJvd3NlciBhc2tzIFZpdGUgZm9yIHRoZW0gYW5kIGdldHMgYSA0MDQsIHNvIHRoZVxuICAgICAgLy8gdXBsb2FkZWQgcGhvdG8gbmV2ZXIgYXBwZWFycyBpbiB0aGUgaW5zcGVjdG9yJ3MgUmVwb3J0IEluYm94LlxuICAgICAgJy91cGxvYWRzJzoge1xuICAgICAgICB0YXJnZXQ6ICdodHRwOi8vbG9jYWxob3N0OjgwODAnLFxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIGJ1aWxkOiB7IG91dERpcjogJ2Rpc3QnLCBzb3VyY2VtYXA6IGZhbHNlIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBK1gsU0FBUyxvQkFBb0I7QUFDNVosT0FBTyxXQUFXO0FBRWxCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsUUFDTixRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUE7QUFBQSxRQUVkLFVBQVUsT0FBTztBQUNmLGdCQUFNLEdBQUcsWUFBWSxDQUFDLGFBQWE7QUFDakMsZ0JBQUksT0FBTyxTQUFTLFFBQVEsY0FBYyxLQUFLLEVBQUUsRUFBRSxTQUFTLG1CQUFtQixHQUFHO0FBQ2hGLHVCQUFTLFFBQVEsZUFBZSxJQUFJO0FBQ3BDLHVCQUFTLFFBQVEsbUJBQW1CLElBQUk7QUFBQSxZQUMxQztBQUFBLFVBQ0YsQ0FBQztBQUFBLFFBQ0g7QUFBQSxNQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFJQSxZQUFZO0FBQUEsUUFDVixRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsTUFDaEI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsT0FBTyxFQUFFLFFBQVEsUUFBUSxXQUFXLE1BQU07QUFDNUMsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K

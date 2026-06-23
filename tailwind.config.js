/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./js/**/*.js"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        'brand-purple-light': '#1B355A',
        'brand-purple':       '#0A192F',
        'brand-purple-dark':  '#020C1B',
        'brand-blue':         '#2563EB',
        'brand-blue-dark':    '#1B355A',
        'brand-green':        '#10b981',
        'brand-green-dark':   '#059669',
        'brand-red':          '#ef4444',
        'brand-red-dark':     '#dc2626',
        'brand-dark':         '#0A192F',
        'brand-dark-2':       '#020C1B',
        'brand-orange':       '#f59e0b',
        'brand-gray-light':   '#F0F4FF',  /* Updated to match glass theme */
        'brand-purple-mid':   '#112240',
      },
      boxShadow: {
        'premium': '0 4px 20px -2px rgba(0, 0, 0, 0.05), 0 0 3px rgba(0,0,0,0.02)',
        'premium-hover': '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      }
    }
  },
  plugins: [],
}

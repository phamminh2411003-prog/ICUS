// Cấu hình Tailwind cho website ICUS.
// Sau khi sửa class trong icus-landing-page/index.html, chạy lại:  npm run build:css
module.exports = {
  content: ['./icus-landing-page/index.html'],
  theme: {
    extend: {
      colors: {
        icus: {
          cream: '#FAF6EF',
          creamCard: '#FFFFFF',
          black: '#171717',
          orange: '#FF5722',
          orangeLight: '#FFF0EB',
          green: '#1B8755',
          greenLight: '#EBF7F0',
          blue: '#1E60D5',
          blueLight: '#EDF4FF',
          yellow: '#FFC727',
          yellowLight: '#FFF9E6',
          pink: '#FFAEB8',
          pinkLight: '#FFF0F3',
        }
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        serif: ['"DM Serif Display"', 'serif'],
        hand: ['"Caveat"', 'cursive'],
      },
      // [Sửa lỗi] Tailwind mặc định không có border-3, decoration-3, scale-102 -> khai báo thêm để viền dày 3px hiển thị đúng
      borderWidth: { 3: '3px' },
      textDecorationThickness: { 3: '3px' },
      scale: { 102: '1.02' },
      // [Sửa lỗi] Hiệu ứng chạy chữ cho thanh thông báo đầu trang (trước đây chưa được định nghĩa nên chữ đứng yên)
      keyframes: {
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } }
      },
      animation: { marquee: 'marquee 40s linear infinite' },
      boxShadow: {
        'brutal-sm': '3px 3px 0px #171717',
        'brutal': '5px 5px 0px #171717',
        'brutal-lg': '8px 8px 0px #171717',
        'brutal-xl': '12px 12px 0px #171717',
      }
    }
  }
};

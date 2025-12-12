document.addEventListener('DOMContentLoaded', () => {
    // Navigation mapping
    const navLinks = {
        'nav-dashboard': 'index.html',
        'nav-ble-monitor': 'ble-monitor.html',
        'nav-map': 'map.html',
        'nav-record-path': 'record-path.html',
        'nav-navigation': 'navigation.html'
    };

    // Add click listeners to navigation elements
    Object.keys(navLinks).forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = navLinks[id];
            });
        }
    });

    // Specific button handlers for BLE monitor page
    if (window.location.pathname.endsWith('ble-monitor.html')) {
        const startScanBtn = document.getElementById('start-scan');
        const stopScanBtn = document.getElementById('stop-scan');
        const scanStatus = document.getElementById('scan-status');
        const scanDot = document.querySelector('#scan-status').previousElementSibling.querySelector('.bg-green-500, .bg-gray-500');


        if (startScanBtn) {
            startScanBtn.addEventListener('click', () => {
                scanStatus.textContent = 'Scanning...';
                scanStatus.parentElement.classList.remove('bg-gray-500/10', 'border-gray-500/20');
                scanStatus.parentElement.classList.add('bg-green-500/10', 'border-green-500/20');
                scanStatus.classList.remove('text-gray-600', 'dark:text-gray-400');
                scanStatus.classList.add('text-green-600', 'dark:text-green-400');
                if (scanDot) {
                    scanDot.classList.remove('bg-gray-500');
                    scanDot.classList.add('bg-green-500');
                    scanDot.previousElementSibling.classList.add('animate-ping');
                }
            });
        }

        if (stopScanBtn) {
            stopScanBtn.addEventListener('click', () => {
                scanStatus.textContent = 'Stopped';
                scanStatus.parentElement.classList.remove('bg-green-500/10', 'border-green-500/20');
                scanStatus.parentElement.classList.add('bg-gray-500/10', 'border-gray-500/20');
                scanStatus.classList.remove('text-green-600', 'dark:text-green-400');
                scanStatus.classList.add('text-gray-600', 'dark:text-gray-400');
                if (scanDot) {
                    scanDot.classList.remove('bg-green-500');
                    scanDot.classList.add('bg-gray-500');
                    scanDot.previousElementSibling.classList.remove('animate-ping');
                }
            });
        }
    }
});

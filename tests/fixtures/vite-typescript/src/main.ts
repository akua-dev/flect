const root = document.querySelector<HTMLDivElement>('#app');

if (root !== null) {
	const button = document.createElement('button');
	button.type = 'button';
	button.textContent = 'Vite app ready';
	button.addEventListener('click', () => {
		button.textContent = 'Vite app used';
	});
	root.append(button);
}

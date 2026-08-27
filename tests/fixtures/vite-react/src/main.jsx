import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
	const [used, setUsed] = useState(false);
	return (
		<main>
			<h1>React project imported</h1>
			<button type='button' onClick={() => setUsed(true)}>
				{used ? 'React app used' : 'Use React app'}
			</button>
		</main>
	);
}

createRoot(document.getElementById('root')).render(<App />);

import { Schema } from 'effect';
import {
	type RefObject,
	type UIEventHandler,
	useCallback,
	useLayoutEffect,
	useRef,
	useState
} from 'react';

const FOLLOW_THRESHOLD_PX = 48;

const FollowState = Schema.Struct({
	following: Schema.Boolean,
	unreadCount: Schema.Number,
	scrollTop: Schema.Number,
	contentKey: Schema.UndefinedOr(Schema.String)
});
type FollowState = typeof FollowState.Type;

export interface StickyFollowController {
	readonly containerRef: RefObject<HTMLDivElement | null>;
	readonly following: boolean;
	readonly unreadCount: number;
	readonly onScroll: UIEventHandler<HTMLDivElement>;
	readonly jumpToLatest: () => void;
}

const initialState = (): FollowState => ({
	following: true,
	unreadCount: 0,
	scrollTop: 0,
	contentKey: undefined
});

export function useStickyFollow(timelineKey: string, contentKey: string): StickyFollowController {
	const containerRef = useRef<HTMLDivElement>(null);
	const statesRef = useRef(new Map<string, FollowState>());
	const activeKeyRef = useRef(timelineKey);
	const activeStateRef = useRef<FollowState>(initialState());
	const [view, setView] = useState(activeStateRef.current);

	const publish = useCallback((next: FollowState) => {
		activeStateRef.current = next;
		statesRef.current.set(activeKeyRef.current, next);
		setView(next);
	}, []);

	useLayoutEffect(() => {
		const element = containerRef.current;
		const previousKey = activeKeyRef.current;
		statesRef.current.set(previousKey, {
			...activeStateRef.current,
			scrollTop: element?.scrollTop ?? activeStateRef.current.scrollTop
		});

		activeKeyRef.current = timelineKey;
		const next = statesRef.current.get(timelineKey) ?? initialState();
		activeStateRef.current = next;
		setView(next);
		if (element !== null) {
			element.scrollTop = next.following ? element.scrollHeight : next.scrollTop;
		}
	}, [timelineKey]);

	useLayoutEffect(() => {
		const current = activeStateRef.current;
		if (current.contentKey === contentKey) {
			return;
		}
		const element = containerRef.current;
		const isInitial = current.contentKey === undefined;
		if (element !== null && current.following) {
			element.scrollTop = element.scrollHeight;
		}
		publish({
			...current,
			contentKey,
			scrollTop: element?.scrollTop ?? current.scrollTop,
			unreadCount: isInitial || current.following ? 0 : current.unreadCount + 1
		});
	}, [contentKey, publish]);

	const onScroll = useCallback<UIEventHandler<HTMLDivElement>>(
		(event) => {
			const element = event.currentTarget;
			const following =
				element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_THRESHOLD_PX;
			publish({
				...activeStateRef.current,
				following,
				unreadCount: following ? 0 : activeStateRef.current.unreadCount,
				scrollTop: element.scrollTop
			});
		},
		[publish]
	);

	const jumpToLatest = useCallback(() => {
		const element = containerRef.current;
		if (element === null) {
			return;
		}
		element.scrollTop = element.scrollHeight;
		publish({
			...activeStateRef.current,
			following: true,
			unreadCount: 0,
			scrollTop: element.scrollTop
		});
	}, [publish]);

	return {
		containerRef,
		following: view.following,
		unreadCount: view.unreadCount,
		onScroll,
		jumpToLatest
	};
}

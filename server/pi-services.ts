import { Layer } from 'effect';
import { ProtectedPromptHostLive } from './credential-prompt-host';
import { PiModelRuntimeLive } from './pi-model-runtime';
import { FlectRuntimeLive, PiSdkLive } from './pi-runtime';
import { ProviderAuthAdapterLive, ProviderAuthenticationLive } from './provider-authentication';

const AuthenticationLive = ProviderAuthenticationLive.pipe(
	Layer.provide(Layer.merge(ProviderAuthAdapterLive, ProtectedPromptHostLive))
);

export const PiApplicationServicesLive = Layer.merge(PiSdkLive, AuthenticationLive).pipe(
	Layer.provide(PiModelRuntimeLive)
);

export const FlectRuntimeWithPiLive = FlectRuntimeLive.pipe(
	Layer.provide(PiApplicationServicesLive)
);

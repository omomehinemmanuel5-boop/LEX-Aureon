// Claude.ai compatibility: some custom-connector OAuth clients POST to the origin-root /register
// instead of the registration_endpoint advertised in OAuth metadata.
export { OPTIONS, POST } from '../oauth/register/route';

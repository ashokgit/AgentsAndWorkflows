import React, { useState } from 'react'; // useState for local button loading if needed, or rely on parent's apiTestState
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import FormHelperText from '@mui/material/FormHelperText';
import Typography from '@mui/material/Typography';
import axios from 'axios'; // For the test API call

// Assuming NodeInputSelector and DraggableTextField are passed as props

const ApiConsumerForm = ({
    node, // For node.id in onUpdate
    formData,
    nodes,
    edges, // For NodeInputSelector
    commonTextFieldProps,
    fieldErrors,
    setFieldErrors, // To set URL error from test handler
    jsonValidity,
    apiTestState, // Passed from parent
    setApiTestState, // Passed from parent to update
    NodeInputSelector,
    DraggableTextField,
    isValidJson, // Passed as prop
    onUpdate, // Passed as prop for test success/failure
    // handleChange & handleBlur are in commonTextFieldProps
}) => {

    const handleTestApiConnection = async () => {
        try {
            // Reset previous test results
            setApiTestState({
                loading: true,
                result: null,
                error: null
            });

            // Validate URL
            if (!formData.url) {
                setFieldErrors(prev => ({ ...prev, url: 'API URL is required for testing.' }));
                setApiTestState({
                    loading: false,
                    result: null,
                    error: 'API URL is required'
                });
                return;
            }
            if (fieldErrors.url) { // Clear previous URL error if any before new test
                setFieldErrors(prev => ({ ...prev, url: null }));
            }

            // Collect API config data from form
            const apiConfig = {
                url: formData.url,
                method: formData.method || 'GET',
                headers: formData.headers || '{}',
                body: formData.body || '',
                query_params: formData.query_params || '{}',
                auth_type: formData.auth_type || 'none',
                timeout: formData.timeout || 30000,
                response_handling: formData.response_handling || 'json'
            };

            // Add auth details based on the selected auth type
            if (formData.auth_type === 'api_key') {
                apiConfig.api_key_name = formData.api_key_name;
                apiConfig.api_key_value = formData.api_key_value;
                apiConfig.api_key_location = formData.api_key_location || 'header';
            } else if (formData.auth_type === 'bearer') {
                apiConfig.bearer_token = formData.bearer_token;
            } else if (formData.auth_type === 'basic') {
                apiConfig.basic_username = formData.basic_username;
                apiConfig.basic_password = formData.basic_password;
            } else if (formData.auth_type === 'oauth2') {
                apiConfig.oauth_token_url = formData.oauth_token_url;
                apiConfig.oauth_client_id = formData.oauth_client_id;
                apiConfig.oauth_client_secret = formData.oauth_client_secret;
                apiConfig.oauth_scope = formData.oauth_scope;
            }

            // Send the test request
            const response = await axios.post('/api/api_consumer/test', apiConfig);

            // Update state with the result
            if (response.data) {
                setApiTestState({
                    loading: false,
                    result: response.data,
                    error: null
                });

                // Update the node with testSuccess flag
                onUpdate(node.id, {
                    testSuccess: true,
                    // Add a timestamp for last successful test
                    lastTestedAt: new Date().toISOString()
                });
            } else {
                throw new Error('No response data returned');
            }
        } catch (error) {
            console.error("API test error:", error);
            setApiTestState({
                loading: false,
                result: null,
                error: error.response?.data?.detail || error.message
            });

            // Clear testSuccess flag if it exists
            if (formData.testSuccess) { // Check against formData from props
                onUpdate(node.id, { testSuccess: false });
            }
        }
    };

    return (
        <>
            <TextField
                label="Name"
                name="node_name"
                value={formData.node_name || ''}
                placeholder="Give this API consumer a descriptive name"
                {...commonTextFieldProps}
            />

            <TextField
                label="API Endpoint URL"
                name="url"
                type="url"
                required
                value={formData.url || ''}
                error={!!fieldErrors.url}
                helperText={fieldErrors.url}
                {...commonTextFieldProps}
            />

            <FormControl fullWidth margin="normal" size="small">
                <InputLabel id="method-select-label">HTTP Method</InputLabel>
                <Select
                    labelId="method-select-label"
                    label="HTTP Method"
                    name="method"
                    value={formData.method || 'GET'}
                    onChange={commonTextFieldProps.onChange}
                    onBlur={commonTextFieldProps.onBlur}
                >
                    <MenuItem value="GET">GET</MenuItem>
                    <MenuItem value="POST">POST</MenuItem>
                    <MenuItem value="PUT">PUT</MenuItem>
                    <MenuItem value="DELETE">DELETE</MenuItem>
                    <MenuItem value="PATCH">PATCH</MenuItem>
                </Select>
            </FormControl>

            <FormControl fullWidth margin="normal" size="small">
                <InputLabel id="auth-type-select-label">Authentication Type</InputLabel>
                <Select
                    labelId="auth-type-select-label"
                    label="Authentication Type"
                    name="auth_type"
                    value={formData.auth_type || 'none'}
                    onChange={commonTextFieldProps.onChange}
                    onBlur={commonTextFieldProps.onBlur}
                >
                    <MenuItem value="none">None</MenuItem>
                    <MenuItem value="api_key">API Key</MenuItem>
                    <MenuItem value="bearer">Bearer Token</MenuItem>
                    <MenuItem value="basic">Basic Auth</MenuItem>
                    <MenuItem value="oauth2">OAuth 2.0</MenuItem>
                    <MenuItem value="custom">Custom</MenuItem>
                </Select>
            </FormControl>

            {formData.auth_type === 'api_key' && (
                <>
                    <TextField
                        label="API Key Name"
                        name="api_key_name"
                        value={formData.api_key_name || ''}
                        placeholder="X-API-Key"
                        {...commonTextFieldProps}
                    />
                    <TextField
                        label="API Key Value"
                        name="api_key_value"
                        type="password"
                        value={formData.api_key_value || ''}
                        placeholder="your-api-key-here"
                        {...commonTextFieldProps}
                    />
                    <FormControl fullWidth margin="normal" size="small">
                        <InputLabel id="api-key-location-label">API Key Location</InputLabel>
                        <Select
                            labelId="api-key-location-label"
                            label="API Key Location"
                            name="api_key_location"
                            value={formData.api_key_location || 'header'}
                            onChange={commonTextFieldProps.onChange}
                            onBlur={commonTextFieldProps.onBlur}
                        >
                            <MenuItem value="header">Header</MenuItem>
                            <MenuItem value="query">Query Parameter</MenuItem>
                        </Select>
                    </FormControl>
                </>
            )}

            {formData.auth_type === 'bearer' && (
                <TextField
                    label="Bearer Token"
                    name="bearer_token"
                    type="password"
                    value={formData.bearer_token || ''}
                    placeholder="your-bearer-token-here"
                    {...commonTextFieldProps}
                />
            )}

            {formData.auth_type === 'basic' && (
                <>
                    <TextField
                        label="Username"
                        name="basic_username"
                        value={formData.basic_username || ''}
                        {...commonTextFieldProps}
                    />
                    <TextField
                        label="Password"
                        name="basic_password"
                        type="password"
                        value={formData.basic_password || ''}
                        {...commonTextFieldProps}
                    />
                </>
            )}

            {formData.auth_type === 'oauth2' && (
                <>
                    <TextField
                        label="Token URL"
                        name="oauth_token_url"
                        type="url"
                        value={formData.oauth_token_url || ''}
                        placeholder="https://example.com/oauth/token"
                        {...commonTextFieldProps}
                    />
                    <TextField
                        label="Client ID"
                        name="oauth_client_id"
                        value={formData.oauth_client_id || ''}
                        {...commonTextFieldProps}
                    />
                    <TextField
                        label="Client Secret"
                        name="oauth_client_secret"
                        type="password"
                        value={formData.oauth_client_secret || ''}
                        {...commonTextFieldProps}
                    />
                    <TextField
                        label="Scope"
                        name="oauth_scope"
                        value={formData.oauth_scope || ''}
                        placeholder="read write"
                        {...commonTextFieldProps}
                    />
                </>
            )}

            <DraggableTextField
                label="Query Parameters (JSON)"
                name="query_params"
                multiline
                rows={3}
                value={formData.query_params || '{}'}
                error={!isValidJson(formData.query_params || '{}') || !!fieldErrors.query_params}
                helperText={!isValidJson(formData.query_params || '{}') ? 'Invalid JSON' : fieldErrors.query_params || 'Parameters to add to the URL query string'}
                InputProps={{ sx: { fontFamily: 'monospace' } }}
                {...commonTextFieldProps}
            />

            <DraggableTextField
                label="Headers (JSON)"
                name="headers"
                multiline
                rows={3}
                value={formData.headers || '{}'}
                error={!jsonValidity.headers || !!fieldErrors.headers} // Using jsonValidity from parent for headers
                helperText={!jsonValidity.headers ? 'Invalid JSON' : fieldErrors.headers}
                InputProps={{ sx: { fontFamily: 'monospace' } }}
                {...commonTextFieldProps}
            />

            <DraggableTextField
                label="Body (JSON)"
                name="body"
                multiline
                rows={6}
                value={formData.body || ''}
                error={!jsonValidity.body || !!fieldErrors.body} // Using jsonValidity from parent for body
                helperText={!jsonValidity.body ? 'Invalid JSON' : fieldErrors.body || 'Defaults to node input if blank. Drag node outputs to create a custom body.'}
                placeholder={'{ "key": "value" } '}
                InputProps={{ sx: { fontFamily: 'monospace' } }}
                {...commonTextFieldProps}
            />

            <FormControl fullWidth margin="normal" size="small">
                <InputLabel id="response-handling-label">Response Handling</InputLabel>
                <Select
                    labelId="response-handling-label"
                    label="Response Handling"
                    name="response_handling"
                    value={formData.response_handling || 'json'}
                    onChange={commonTextFieldProps.onChange}
                    onBlur={commonTextFieldProps.onBlur}
                >
                    <MenuItem value="json">Parse as JSON</MenuItem>
                    <MenuItem value="text">Raw Text</MenuItem>
                    <MenuItem value="binary">Binary Data</MenuItem>
                </Select>
                <FormHelperText>How to process the API response</FormHelperText>
            </FormControl>

            <TextField
                label="Timeout (ms)"
                name="timeout"
                type="number"
                value={formData.timeout || '30000'}
                placeholder="30000"
                helperText="Maximum time to wait for response (milliseconds)"
                {...commonTextFieldProps}
            />

            <FormControl fullWidth margin="normal" size="small">
                <InputLabel id="retry-policy-label">Retry Policy</InputLabel>
                <Select
                    labelId="retry-policy-label"
                    label="Retry Policy"
                    name="retry_policy"
                    value={formData.retry_policy || 'none'}
                    onChange={commonTextFieldProps.onChange}
                    onBlur={commonTextFieldProps.onBlur}
                >
                    <MenuItem value="none">No Retries</MenuItem>
                    <MenuItem value="simple">Simple (3 retries)</MenuItem>
                    <MenuItem value="exponential">Exponential Backoff</MenuItem>
                </Select>
                <FormHelperText>How to handle request failures</FormHelperText>
            </FormControl>

            <Button
                variant="contained"
                color="primary"
                sx={{ mt: 2 }}
                onClick={handleTestApiConnection}
                disabled={apiTestState.loading}
                startIcon={apiTestState.loading ? <CircularProgress size={20} /> : null}
            >
                {apiTestState.loading ? 'Testing...' : 'Test API Connection'}
            </Button>

            {apiTestState.result && (
                <Alert severity="success" sx={{ mt: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle2">
                            API Test Successful!
                            <span style={{
                                backgroundColor: '#4caf50',
                                color: 'white',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '0.75rem',
                                marginLeft: '8px'
                            }}>
                                Verified
                            </span>
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                            {/* formData.lastTestedAt is updated by onUpdate, so it should be available here if test was successful */}
                            {formData.lastTestedAt ? `Last tested: ${new Date(formData.lastTestedAt).toLocaleString()}` : ''}
                        </Typography>
                    </Box>
                    <Typography variant="body2">
                        Status: {apiTestState.result.status_code}
                    </Typography>
                    <Box sx={{ mt: 1, p: 1, maxHeight: '150px', overflow: 'auto', bgcolor: 'background.paper', borderRadius: 1, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        <pre style={{ margin: 0 }}>
                            {typeof apiTestState.result.response === 'object'
                                ? JSON.stringify(apiTestState.result.response, null, 2)
                                : apiTestState.result.response}
                        </pre>
                    </Box>
                </Alert>
            )}

            {apiTestState.error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Typography variant="subtitle2">
                            API Test Failed
                            <span style={{
                                backgroundColor: '#f44336',
                                color: 'white',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '0.75rem',
                                marginLeft: '8px'
                            }}>
                                Error
                            </span>
                        </Typography>
                    </Box>
                    <Typography variant="body2">{apiTestState.error}</Typography>
                </Alert>
            )}
        </>
    );
};

export default ApiConsumerForm;

import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';

const ModelConfigForm = ({
    formData,
    commonTextFieldProps,
    fieldErrors,
    testState,
    handleTestModelConfig,
    // No NodeInputSelector or DraggableTextField needed for this form based on original code
}) => {
    return (
        <>
            <Typography variant="subtitle2" sx={{ mb: 2 }}>
                Configure a model that can be used across multiple LLM nodes
            </Typography>
            <TextField
                label="Configuration Name"
                name="config_name"
                required
                value={formData.config_name || ''}
                error={!!fieldErrors.config_name}
                helperText={fieldErrors.config_name || "Give this configuration a name to reference it"}
                placeholder="e.g., GPT-4, Claude-3-Sonnet"
                {...commonTextFieldProps}
            />
            <TextField
                label="Model"
                name="model"
                required
                value={formData.model || ''}
                error={!!fieldErrors.model}
                helperText={fieldErrors.model}
                placeholder='e.g., gpt-4o, claude-3-sonnet-20240229'
                {...commonTextFieldProps}
            />
            <TextField
                label="API Key"
                name="api_key"
                type="password"
                value={formData.api_key || ''}
                placeholder="Uses environment variable if blank"
                {...commonTextFieldProps}
            />
            <TextField
                label="API Base URL (Optional)"
                name="api_base"
                type="url"
                value={formData.api_base || ''}
                placeholder="e.g., http://localhost:11434/v1"
                {...commonTextFieldProps}
            />

            <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleTestModelConfig}
                    disabled={testState.loading || !formData.model} // Original logic: disabled if loading or no model
                    startIcon={testState.loading ? <CircularProgress size={20} /> : null}
                >
                    {testState.loading ? 'Testing...' : 'Test Configuration'}
                </Button>

                {testState.result && (
                    <Alert severity="success" sx={{ mt: 2 }}>
                        <Typography variant="subtitle2">Test Successful!</Typography>
                        <Typography variant="body2">
                            Response: {testState.result.response.substring(0, 100)}
                            {testState.result.response.length > 100 ? '...' : ''}
                        </Typography>
                        {testState.result.usage && (
                            <Typography variant="caption" display="block">
                                Tokens: {testState.result.usage.total_tokens || 'N/A'}
                            </Typography>
                        )}
                    </Alert>
                )}

                {testState.error && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        <Typography variant="subtitle2">Test Failed</Typography>
                        <Typography variant="body2">{testState.error}</Typography>
                    </Alert>
                )}
            </Box>
        </>
    );
};

export default ModelConfigForm; 
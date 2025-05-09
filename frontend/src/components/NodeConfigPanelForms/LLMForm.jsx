import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import FormHelperText from '@mui/material/FormHelperText';

// Assuming NodeInputSelector and DraggableTextField are imported in the parent and passed as props
// or imported directly if they are in accessible paths. For now, let's assume they are passed.

const LLMForm = ({
    node,
    formData,
    nodes,
    edges,
    commonTextFieldProps,
    fieldErrors,
    testState,
    handleTestLLM,
    NodeInputSelector, // Passed as prop
    DraggableTextField, // Passed as prop
    // handleChange and handleBlur are part of commonTextFieldProps or can be passed separately
    // For clarity, let's assume commonTextFieldProps includes onChange and onBlur handlers
    // that are already correctly bound or utilize handleChange/handleBlur from the parent.
    // If not, they'd need to be passed explicitly:
    // handleChange,
    // handleBlur,
}) => {
    // Get all model configurations from nodes
    const modelConfigs = nodes?.filter(n => n.type === 'model_config').map(n => ({
        id: n.id,
        name: n.data?.config_name || 'Unnamed Config',
        model: n.data?.model
    })) || [];

    // Add validation warning if no model_config_id is selected and no model is specified
    const hasNoModel = !formData.model && !formData.model_config_id;
    const showModelWarning = hasNoModel && modelConfigs.length > 0;

    return (
        <>
            <TextField
                label="Name"
                name="node_name"
                value={formData.node_name || ''}
                placeholder="Give this LLM node a descriptive name"
                {...commonTextFieldProps}
            />

            <DraggableTextField
                label="Prompt"
                name="prompt"
                multiline
                rows={4}
                value={formData.prompt || ''}
                {...commonTextFieldProps}
            />

            {modelConfigs.length > 0 && (
                <FormControl fullWidth margin="normal" size="small">
                    <InputLabel id="model-config-select-label">Use Model Configuration</InputLabel>
                    <Select
                        labelId="model-config-select-label"
                        name="model_config_id"
                        value={formData.model_config_id || ''}
                        label="Use Model Configuration"
                        onChange={commonTextFieldProps.onChange} // Assuming onChange is part of commonTextFieldProps
                        onBlur={commonTextFieldProps.onBlur}     // Assuming onBlur is part of commonTextFieldProps
                        error={showModelWarning}
                    >
                        <MenuItem value="">
                            <em>Configure manually</em>
                        </MenuItem>
                        {modelConfigs.map(config => (
                            <MenuItem key={config.id} value={config.id}>
                                {config.name} ({config.model})
                            </MenuItem>
                        ))}
                    </Select>
                    <FormHelperText error={showModelWarning}>
                        {showModelWarning
                            ? "LLM nodes should use a model configuration or specify a model"
                            : formData.model_config_id
                                ? "Using shared model configuration"
                                : "Or configure model manually below"}
                    </FormHelperText>
                </FormControl>
            )}

            {!formData.model_config_id && (
                <>
                    <TextField
                        label="Model"
                        name="model"
                        required
                        value={formData.model || ''}
                        error={!!fieldErrors.model || showModelWarning}
                        helperText={fieldErrors.model || (showModelWarning ? "Model is required" : "")}
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
                </>
            )}

            <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleTestLLM}
                    disabled={testState.loading || (!formData.model && !formData.model_config_id)}
                    startIcon={testState.loading ? <CircularProgress size={20} /> : null}
                >
                    {testState.loading ? 'Testing...' : 'Test LLM Node'}
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

export default LLMForm; 
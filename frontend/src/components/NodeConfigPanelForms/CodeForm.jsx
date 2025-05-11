import React from 'react';
import TextField from '@mui/material/TextField';
import FormHelperText from '@mui/material/FormHelperText';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import MenuItem from '@mui/material/MenuItem';

// Assuming NodeInputSelector and DraggableTextField are passed as props

const CodeForm = ({
    node,
    formData,
    nodes,
    edges, // Needed for NodeInputSelector
    commonTextFieldProps,
    NodeInputSelector, // Passed as prop
    DraggableTextField, // Passed as prop
    // fieldErrors is not used in the original code for this form type
    // testState and test handlers are not used for this form type
    handleTestCode, // Added prop
    testState, // Added prop
    aiInstruction, // New: user's instruction for AI
    onAiInstructionChange, // New: handler for AI instruction change
    handleGenerateCodeWithAI, // New: handler for AI generation button
    aiGeneratingCode, // New: loading state for AI generation
    // Props for AI Model Config Selection
    aiModelConfigId, // ID of the selected model_config node for AI
    onAiModelConfigIdChange, // Handler for when AI model config selection changes
    modelConfigNodes, // List of available model_config nodes
}) => {
    const [requirementsExpanded, setRequirementsExpanded] = React.useState(false);

    return (
        <>
            {/* Removed NodeInputSelector from here */}

            <TextField
                label="Name"
                name="node_name"
                value={formData.node_name || ''}
                placeholder="Give this code node a descriptive name"
                {...commonTextFieldProps}
            />

            <DraggableTextField
                label="Python Code"
                name="code"
                multiline
                rows={10}
                value={formData.code || ''}
                placeholder={'def execute(input_data):\n    # Access input with input_data["key"]\n    return {"processed_value": ...}'}
                InputProps={{ sx: { fontFamily: 'monospace' } }}
                {...commonTextFieldProps}
            />
            <FormHelperText sx={{ ml: '10px' }}>
                Your code receives upstream node outputs as `input_data` dict. The return value becomes this node's output.
            </FormHelperText>

            {/* Collapsible Section for Requirements */}
            <Box sx={{ mt: 2, mb: 1 }}>
                <Button
                    onClick={() => setRequirementsExpanded(!requirementsExpanded)}
                    fullWidth
                    sx={{
                        justifyContent: 'space-between',
                        textTransform: 'none',
                        color: 'text.secondary',
                        '&:hover': {
                            backgroundColor: 'action.hover'
                        }
                    }}
                    endIcon={requirementsExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                >
                    <Typography variant="body2" fontWeight="medium">
                        Python Package Requirements
                    </Typography>
                </Button>
                <Collapse in={requirementsExpanded}>
                    <Box sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, mt: 0.5 }}>
                        <DraggableTextField
                            label="Requirements Content"
                            name="requirements" // New field for requirements
                            multiline
                            rows={5}
                            value={formData.requirements || ''} // Bind to formData.requirements
                            placeholder={"# e.g., requests==2.25.1\n# numpy>=1.20"}
                            InputProps={{ sx: { fontFamily: 'monospace' } }}
                            variant="outlined" // Explicitly set variant for consistency
                            size="small" // Explicitly set size
                            fullWidth // Ensure it takes full width
                            margin="none" // Remove default margin from commonTextFieldProps if any conflict
                            onChange={commonTextFieldProps.onChange} // Pass specific handlers
                            onBlur={commonTextFieldProps.onBlur} // Pass specific handlers
                        />
                        <FormHelperText sx={{ mt: 1, ml: '2px' }}>
                            Enter one package per line, same format as a requirements.txt file. This will be used to build a dedicated environment for your code.
                        </FormHelperText>
                    </Box>
                </Collapse>
            </Box>

            <Box sx={{ mt: 3, mb: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, backgroundColor: 'action.hover' }}>
                <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.secondary' }}>
                    AI Code Generation
                </Typography>
                <TextField
                    label="Instruction for AI"
                    name="ai_instruction"
                    multiline
                    rows={3}
                    value={aiInstruction || ''}
                    placeholder="e.g., 'Create a function that takes input_data, sums all values if they are numbers, and returns the sum. If input_data has a 'message' key, append it to the result.'"
                    variant="outlined"
                    size="small"
                    fullWidth
                    onChange={onAiInstructionChange}
                    sx={{ mb: 1 }}
                />
                <TextField
                    select
                    label="AI Model Configuration (Optional)"
                    value={aiModelConfigId || ''}
                    onChange={onAiModelConfigIdChange} // This will be a new handler in NodeConfigPanel
                    variant="outlined"
                    size="small"
                    fullWidth
                    sx={{ mb: 1 }}
                    helperText="Select a Model Configuration node to use for AI code generation. If blank, defaults will be used."
                >
                    <MenuItem value="">
                        <em>None (Use default/environment settings)</em>
                    </MenuItem>
                    {modelConfigNodes && modelConfigNodes.map((configNode) => (
                        <MenuItem key={configNode.id} value={configNode.id}>
                            {configNode.data?.config_name || configNode.data?.label || configNode.id}
                        </MenuItem>
                    ))}
                </TextField>
                <Button
                    variant="contained"
                    color="secondary"
                    size="small"
                    onClick={handleGenerateCodeWithAI}
                    disabled={aiGeneratingCode || !aiInstruction}
                    startIcon={aiGeneratingCode ? <CircularProgress size={18} color="inherit" /> : <AutorenewIcon />}
                >
                    {aiGeneratingCode ? 'Generating...' : 'Generate / Update Code'}
                </Button>
                <FormHelperText sx={{ mt: 0.5, ml: '2px' }}>
                    Describe what you want the code to do. The AI will attempt to generate or update the Python code above.
                </FormHelperText>
            </Box>

            <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleTestCode}
                    disabled={testState?.loading}
                    startIcon={testState?.loading ? <CircularProgress size={20} color="inherit" /> : null}
                >
                    {testState?.loading ? 'Testing...' : 'Test Code'}
                </Button>
            </Box>

            {testState?.error && (
                <Typography color="error" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                    Error: {testState.error}
                </Typography>
            )}
            {/* Result display will be handled by NodeConfigPanel's output section */}
        </>
    );
};

export default CodeForm; 
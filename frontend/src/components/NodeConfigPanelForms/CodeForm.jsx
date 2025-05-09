import React from 'react';
import TextField from '@mui/material/TextField';
import FormHelperText from '@mui/material/FormHelperText';

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
}) => {
    return (
        <>
            <NodeInputSelector node={node} nodes={nodes} edges={edges} />

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
            <FormHelperText sx={{ ml: '10px' }}>Input available as `input_data` dict. Drag node outputs to use them.</FormHelperText>
        </>
    );
};

export default CodeForm; 